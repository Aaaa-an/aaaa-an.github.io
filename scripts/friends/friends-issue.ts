import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	applyFriendOperation,
	assertFriendsData,
	exportFriendsJson,
	validateFriendsData,
} from "../../src/utils/friends-data";
import {
	applicationToOperation,
	parseAdminOperation,
	parseFriendApplication,
} from "./issue-form";

type GitHubIssueEvent = {
	issue?: {
		number?: number;
		body?: string;
		title?: string;
		user?: { login?: string };
	};
	repository?: { full_name?: string };
};

const mode = process.argv[2];
const eventPath = process.env.GITHUB_EVENT_PATH;
const issueBodyPath = process.env.FRIENDS_ISSUE_BODY_PATH;
const resultDir = resolve(process.env.FRIENDS_RESULT_DIR || ".");
const dataPath = resolve(
	process.env.FRIENDS_DATA_PATH || "src/data/friends.json",
);
const resultJsonPath = resolve(resultDir, "friends-action-result.json");
const resultMarkdownPath = resolve(resultDir, "friends-action-result.md");

if (!mode || !eventPath) {
	throw new Error(
		"用法：friends-issue.ts <validate-application|approve-application|apply-admin>，并提供 GITHUB_EVENT_PATH",
	);
}

const event = JSON.parse(await readFile(eventPath, "utf8")) as GitHubIssueEvent;
const issueBody = issueBodyPath
	? await readFile(issueBodyPath, "utf8")
	: event.issue?.body || "";
const current = JSON.parse(await readFile(dataPath, "utf8")) as unknown;
assertFriendsData(current);

let valid = false;
let changed = false;
let message = "";
let errors: Array<{ path: string; message: string }> = [];
let snapshot = "";

try {
	if (mode === "validate-application" || mode === "approve-application") {
		const application = parseFriendApplication(issueBody);
		snapshot = createHash("sha256")
			.update(JSON.stringify(application))
			.digest("hex");
		const next = applyFriendOperation(
			current,
			applicationToOperation(application),
		);
		const result = validateFriendsData(next);
		valid = result.valid;
		errors = result.errors;
		message = valid
			? "申请字段与现有友链数据校验通过，等待管理员审核。"
			: "申请未通过数据校验，请修改 Issue 中对应字段。";
		if (valid && mode === "approve-application") {
			await writeFile(dataPath, exportFriendsJson(next));
			changed = true;
			message = "申请已转换为友链数据，等待 Pull Request 合并。";
		}
	} else if (mode === "apply-admin") {
		const operation = parseAdminOperation(issueBody);
		const next = applyFriendOperation(current, operation);
		const result = validateFriendsData(next);
		valid = result.valid;
		errors = result.errors;
		if (valid) {
			await writeFile(dataPath, exportFriendsJson(next));
			changed = true;
			message = "管理员操作已通过校验，等待 Pull Request 合并。";
		}
	} else {
		throw new Error(`未知模式：${mode}`);
	}
} catch (error) {
	valid = false;
	message = error instanceof Error ? error.message : String(error);
	errors = [{ path: "$", message }];
}

const result = {
	mode,
	valid,
	changed,
	issue: event.issue?.number || null,
	repository: event.repository?.full_name || null,
	message,
	snapshot: snapshot || null,
	errors,
};
const automationMarker = snapshot
	? `<!-- friends-validation-snapshot:${snapshot} -->`
	: "<!-- friends-admin-validation -->";
await writeFile(resultJsonPath, `${JSON.stringify(result, null, 2)}\n`);
await writeFile(
	resultMarkdownPath,
	[
		valid ? "## ✅ 友链自动校验通过" : "## ❌ 友链自动校验未通过",
		"",
		message,
		"",
		automationMarker,
		...(errors.length
			? [
					"",
					"### 需要处理的问题",
					"",
					...errors.map((item) => `- \`${item.path}\`：${item.message}`),
				]
			: []),
		"",
		"> 此结果由仓库内固定脚本解析 GitHub 事件文件生成；Issue 内容没有作为 Shell 命令执行。",
		"",
	].join("\n"),
);

if (process.env.GITHUB_OUTPUT) {
	await appendFile(
		process.env.GITHUB_OUTPUT,
		`valid=${valid}\nchanged=${changed}\nsnapshot=${snapshot}\nresult_markdown=${resultMarkdownPath.replace(/\\/g, "/")}\n`,
	);
}
console.log(JSON.stringify(result, null, 2));
