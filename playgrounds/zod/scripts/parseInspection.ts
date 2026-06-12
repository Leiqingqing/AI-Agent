import { ZodError, z } from "zod";

const userSchema = z.object({
  name: z.string().min(2, "name 至少 2 个字符"),
  age: z.number().int().min(18, "age 必须 >= 18"),
  email: z.email("email 格式不正确"),
  profile: z.object({
    role: z.enum(["admin", "editor", "viewer"]),
    tags: z.array(z.string().min(2, "tag 至少 2 个字符")).min(1, "至少提供一个 tag"),
  }),
});

const invalidUser = {
  name: "Q",
  age: 16,
  email: "not-an-email",
  profile: {
    role: "guest",
    tags: ["ok", "x"],
  },
};

function showParseError(error: ZodError) {
  console.log("\n1. error.issues");
  console.log("适合保留最原始的错误明细，便于逐条遍历或自定义处理");
  console.dir(error.issues, { depth: null });

  console.log("\n2. error.flatten()");
  console.log("适合表单场景，快速按字段查看错误");
  console.dir(error.flatten(), { depth: null });

  console.log("\n3. error.format()");
  console.log("适合嵌套对象场景，能看到更完整的层级结构");
  console.dir(error.format(), { depth: null });
}

function runParse() {
  console.log("=== parse ===");

  try {
    const parsed = userSchema.parse(invalidUser);
    console.log("parse success:", parsed);
  } catch (error) {
    if (error instanceof ZodError) {
      console.log("parse failed");
      showParseError(error);
      return;
    }

    throw error;
  }
}

function runSafeParse() {
  console.log("\n=== safeParse ===");

  const result = userSchema.safeParse(invalidUser);

  if (result.success) {
    console.log("safeParse success:", result.data);
    return;
  }

  console.log("safeParse failed");
  console.log("safeParse 返回的 error 也是同一个 ZodError 对象结构");
  console.dir(result.error.flatten(), { depth: null });
}

function main() {
  console.log("同一份数据：", invalidUser);
  runParse();
  runSafeParse();
}

main();