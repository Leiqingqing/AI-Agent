import { z, ZodError } from "zod";

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
  console.dir(error.issues, { depth: null });

  console.log("\n2. z.treeifyError(error)");
  console.dir(z.treeifyError(error), { depth: null });

  console.log("\n3. z.prettifyError(error)");
  console.log(z.prettifyError(error));
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
  console.dir(result.error.issues, { depth: null });
}

function main() {
  console.log("同一份数据：", invalidUser);
  runParse();
  runSafeParse();
}

main();