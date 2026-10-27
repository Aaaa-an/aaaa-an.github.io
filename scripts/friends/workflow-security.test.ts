import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FriendsDataFile } from "../../src/types/friendsConfig";

const tempRoot = await mkdtemp(join(tmpdir(), "friends-workflow-audit-"));
const eventPath = join(tempRoot, "event.json");
const bodyPath = join(tempRoot, "issue-body.md");
const scriptPath = resolve("scripts/friends/friends-issue.ts");
const empty: FriendsDataFile = { version: 1, revision: 0, friends: [] };

const applicationBody = [
	"### 网站名称",
	"并发测试站",
	"",
	"### 网站 URL",
	"https://concurrency.example/",
	"",
	"### 网站头像 / Logo URL",
	"https://concurrency.example/logo.png",
	"",
	"### 网站简介",
	"工作流安全测试",
	"",
	"### 网站分类或标签",
	"Blog, Audit",
	"",
	"### 申请说明",
	"验证审核快照",
].join("\n");

await writeFile(
	eventPath,
	JSON.stringify({
		issue: {
			number: 42,
			title: "[友链申请] 并发测试站",
			body: applicationBody,
			user: { login: "visitor" },
		},
		repository: { full_name: "Aaaa-an/aaaa-an.github.io" },
	}),
);
await writeFile(bodyPath, applicationBody);

async function runIssueMode(
	mode: "validate-application" | "approve-application" | "apply-admin",
	data: FriendsDataFile,
	customBody = applicationBody,
) {
	const runDir = await mkdtemp(join(tempRoot, `${mode}-`));
	const dataPath = join(runDir, "friends.json");
	const runBodyPath = join(runDir, "issue-body.md");
	await mkdir(runDir, { recursive: true });
	await writeFile(dataPath, `${JSON.stringify(data, null, 2)}\n`);
	await writeFile(runBodyPath, customBody);
	const execution = spawnSync(
		process.execPath,
		["--import", "tsx", scriptPath, mode],
		{
			cwd: resolve("."),
			encoding: "utf8",
			env: {
				...process.env,
				GITHUB_EVENT_PATH: eventPath,
				FRIENDS_ISSUE_BODY_PATH: runBodyPath,
				FRIENDS_DATA_PATH: dataPath,
				FRIENDS_RESULT_DIR: runDir,
			},
		},
	);
	assert.equal(
		execution.status,
		0,
		`${mode} 执行失败：${execution.stderr || execution.stdout}`,
	);
	return {
		result: JSON.parse(
			await readFile(join(runDir, "friends-action-result.json"), "utf8"),
		) as { valid: boolean; changed: boolean; snapshot: string | null },
		markdown: await readFile(join(runDir, "friends-action-result.md"), "utf8"),
		data: JSON.parse(await readFile(dataPath, "utf8")) as FriendsDataFile,
	};
}

const validation = await runIssueMode("validate-application", empty);
assert.equal(validation.result.valid, true, "正常申请应通过校验");
assert.match(validation.result.snapshot || "", /^[a-f0-9]{64}$/);
assert.ok(
	validation.markdown.includes(
		`<!-- friends-validation-snapshot:${validation.result.snapshot} -->`,
	),
	"校验评论应包含不可歧义的审核快照",
);
assert.deepEqual(validation.data, empty, "校验不得修改友链数据");

const approval = await runIssueMode("approve-application", empty);
assert.equal(approval.result.valid, true, "批准合法申请");
assert.equal(approval.data.revision, 1, "批准后修订号递增");
assert.equal(approval.data.friends.length, 1, "批准后新增一条友链");

const duplicateApproval = await runIssueMode(
	"approve-application",
	approval.data,
);
assert.equal(
	duplicateApproval.result.valid,
	false,
	"重复批准应被重复地址校验阻止",
);
assert.deepEqual(
	duplicateApproval.data,
	approval.data,
	"重复事件不得再次修改数据",
);

const replacement: FriendsDataFile = {
	version: 1,
	revision: 99,
	friends: [],
};
const currentAdminBody = `### 操作数据（JSON）\n\n${JSON.stringify({
	operation: "replace",
	baseRevision: 0,
	data: replacement,
})}`;
const currentAdmin = await runIssueMode("apply-admin", empty, currentAdminBody);
assert.equal(currentAdmin.result.valid, true, "当前修订的管理员操作应通过");
assert.equal(currentAdmin.data.revision, 1, "导入数据不能自行伪造修订号");

const staleAdmin = await runIssueMode(
	"apply-admin",
	currentAdmin.data,
	currentAdminBody,
);
assert.equal(staleAdmin.result.valid, false, "过期全量管理请求应被阻止");
assert.deepEqual(
	staleAdmin.data,
	currentAdmin.data,
	"过期请求不得覆盖较新的数据",
);

const workflowFiles = [
	".github/workflows/build.yml",
	".github/workflows/biome.yml",
	".github/workflows/deploy.yml",
	".github/workflows/friends-application.yml",
	".github/workflows/friends-review.yml",
	".github/workflows/friends-admin.yml",
];
for (const file of workflowFiles) {
	const source = await readFile(resolve(file), "utf8");
	assert.doesNotMatch(source, /(?:ghp_|github_pat_|PERSONAL_ACCESS_TOKEN)/i);
	for (const reference of source.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/g)) {
		assert.match(
			reference[1] || "",
			/^[a-f0-9]{40}$/,
			`${file} 必须锁定完整 Action SHA`,
		);
	}
}

const reviewWorkflow = await readFile(
	resolve(".github/workflows/friends-review.yml"),
	"utf8",
);
assert.ok(reviewWorkflow.includes("collaborators/$ACTOR/permission"));
assert.ok(reviewWorkflow.includes("friends-validation-snapshot"));
assert.match(reviewWorkflow, /group:\s+friends-issue-/);

const adminWorkflow = await readFile(
	resolve(".github/workflows/friends-admin.yml"),
	"utf8",
);
assert.ok(adminWorkflow.includes("github.event.issue.user.login == 'Aaaa-an'"));
assert.ok(adminWorkflow.includes("collaborators/$ACTOR/permission"));

console.log(
	`友链工作流安全测试通过：快照锁定、重复事件、修订冲突、管理员权限声明和 Action SHA。临时证据：${tempRoot}`,
);
