import { Command, END, INTERRUPT, ReducedValue, START, StateGraph, StateSchema, interrupt, isInterrupted } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { z } from "zod";

const THREAD_ID = "manuscript-approval-flow-thread";

const approverSchema = z.object({
  step: z.string(),
  approver: z.string(),
});

const manuscriptSchema = z.object({
  title: z.string().default(""),
  content: z.string().default(""),
  version: z.number().default(1),
});

const manuscriptStatusSchema = z.enum(["draft", "underReview", "revising", "published"]);

const approvalRecordSchema = z.object({
  step: z.string(),
  approver: z.string(),
  approved: z.boolean(),
  comment: z.string().default(""),
  manuscriptVersion: z.number(),
  reviewedAt: z.string(),
});

const schemaState = new StateSchema({
  topic: z.string(),
  approvers: z.array(approverSchema).default(() => []),
  manuscript: manuscriptSchema.default(() => ({ title: "", content: "", version: 1 })),
  manuscriptStatus: manuscriptStatusSchema.default("draft"),
  approvals: new ReducedValue(z.array(approvalRecordSchema).default(() => []), {
    inputSchema: z.array(approvalRecordSchema),
    reducer: (current, update) => current.concat(update),
  }),
});

type Approver = z.infer<typeof approverSchema>;
type ApprovalRecord = z.infer<typeof approvalRecordSchema>;
type WorkflowState = typeof schemaState.State;
type WorkflowUpdate = typeof schemaState.Update;
type ResumeApproval = Pick<ApprovalRecord, "approved" | "comment">;
type WorkflowNode = "humanApproval" | "reviseManuscript" | "publishManuscript" | typeof END;

const INITIAL_APPROVERS: Approver[] = [
  { step: "editorReview", approver: "编辑" },
  { step: "supervisorReview", approver: "主管" },
  { step: "qualityReview", approver: "第三责任人" },
];

const RESUME_APPROVALS: ResumeApproval[] = [
  { approved: true, comment: "编辑审批通过，结构清楚。" },
  { approved: false, comment: "主管驳回：补充发布口径。" },
  { approved: true, comment: "编辑复审通过。" },
  { approved: true, comment: "主管复审通过。" },
  { approved: true, comment: "第三责任人审批通过。" },
];

function printStep(title: string) {
  console.log(`\n=== ${title} ===`);
}

function findNextApprover(state: WorkflowState): Approver | undefined {
  const currentVersion = state.manuscript.version;

  return state.approvers.find((approver) => {
    const latestRecord = state.approvals.findLast(
      (record) => record.manuscriptVersion === currentVersion && record.step === approver.step
    );

    return latestRecord?.approved !== true;
  });
}

function createApprovalRecord(state: WorkflowState, approver: Approver, resume: ResumeApproval): ApprovalRecord {
  return {
    step: approver.step,
    approver: approver.approver,
    approved: resume.approved,
    comment: resume.comment,
    manuscriptVersion: state.manuscript.version,
    reviewedAt: new Date().toISOString(),
  };
}

function hasMoreApprovers(state: WorkflowState, currentStep: string): boolean {
  const currentIndex = state.approvers.findIndex((approver) => approver.step === currentStep);

  return currentIndex >= 0 && currentIndex < state.approvers.length - 1;
}

function createNextManuscript(state: WorkflowState): typeof manuscriptSchema._output {
  const latestRejection = state.approvals.findLast((record) => !record.approved);

  if (state.manuscriptStatus === "draft") {
    return {
      title: `${state.topic}发布稿`,
      content: `这是一版关于「${state.topic}」的稿件。`,
      version: 1,
    };
  }

  return {
    ...state.manuscript,
    content: `${state.manuscript.content}\n修改说明：${latestRejection?.comment ?? "根据审批意见修改"}`,
    version: state.manuscript.version + 1,
  };
}

function buildGraph() {
  async function generateManuscriptNode(state: WorkflowState): Promise<WorkflowUpdate> {
    printStep("generateManuscript");
    const manuscript = createNextManuscript(state);

    console.log(`生成稿件 v${manuscript.version}: ${manuscript.title}`);

    return {
      manuscript,
      manuscriptStatus: "underReview",
    };
  }

  async function humanApprovalNode(state: WorkflowState): Promise<Command<unknown, WorkflowUpdate, WorkflowNode>> {
    printStep("humanApproval");
    const approver = findNextApprover(state);

    if (!approver) {
      console.log("当前版本全部审批通过，流转到发布节点。");

      return new Command({ goto: "publishManuscript" });
    }

    console.log(`当前审批节点: ${approver.step} / ${approver.approver}`);

    const resume = interrupt<unknown, ResumeApproval>({
      question: "请审批当前稿件",
      step: approver.step,
      approver: approver.approver,
      manuscript: state.manuscript,
    });
    const approval = createApprovalRecord(state, approver, resume);
    const goto = !approval.approved
      ? "reviseManuscript"
      : hasMoreApprovers(state, approval.step)
        ? "humanApproval"
        : "publishManuscript";

    console.log(`${approval.approver}: ${approval.approved ? "通过" : "驳回"} - ${approval.comment}`);

    return new Command({
      update: { approvals: [approval] },
      goto,
    });
  }

  async function reviseManuscriptNode(state: WorkflowState): Promise<WorkflowUpdate> {
    printStep("reviseManuscript");
    const latestRejection = state.approvals.findLast((record) => !record.approved);

    console.log(`根据驳回意见修改稿件: ${latestRejection?.comment ?? "根据审批意见修改"}`);

    return {
      manuscriptStatus: "revising",
    };
  }

  async function publishManuscriptNode(): Promise<WorkflowUpdate> {
    printStep("publishManuscript");
    console.log("稿件发布完成。");

    return {
      manuscriptStatus: "published",
    };
  }

  return new StateGraph(schemaState)
    .addNode("generateManuscript", generateManuscriptNode)
    .addNode("humanApproval", humanApprovalNode, { ends: ["humanApproval", "reviseManuscript", "publishManuscript"] })
    .addNode("reviseManuscript", reviseManuscriptNode)
    .addNode("publishManuscript", publishManuscriptNode)
    .addEdge(START, "generateManuscript")
    .addEdge("generateManuscript", "humanApproval")
    .addEdge("reviseManuscript", "generateManuscript")
    .addEdge("publishManuscript", END)
    .compile({
      checkpointer: new MemorySaver(),
    });
}

function printInterrupt(value: unknown) {
  if (!isInterrupted(value)) {
    return;
  }

  const interruptValue = value[INTERRUPT][0]?.value;
  console.log("\n--- interrupted ---");
  console.dir(interruptValue, { depth: null });
}

function printFinalState(state: WorkflowState) {
  console.log("\n=== finalState ===");
  console.log(`manuscriptStatus: ${state.manuscriptStatus}`);
  console.log(`manuscript: v${state.manuscript.version} ${state.manuscript.title}`);
  console.log("approvals:");

  for (const record of state.approvals) {
    console.log(
      `- v${record.manuscriptVersion} ${record.approver} ${record.approved ? "通过" : "驳回"}: ${record.comment}`
    );
  }
}

async function main() {
  const graph = buildGraph();
  const config = { configurable: { thread_id: THREAD_ID } };

  console.log("LangGraph demo: state + routing + checkpoint + interrupt + Command");
  console.log(`thread_id: ${THREAD_ID}`);

  let result = await graph.invoke(
    {
      topic: "AI产品上线",
      approvers: INITIAL_APPROVERS,
    },
    config
  );
  printInterrupt(result);

  for (const resume of RESUME_APPROVALS) {
    result = await graph.invoke(new Command({ resume }), config);
    printInterrupt(result);
  }

  const checkpoint = await graph.getState(config);
  printFinalState(checkpoint.values);
}

main().catch((error) => {
  console.error("manuscript-approval-flow failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});