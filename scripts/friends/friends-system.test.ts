import assert from "node:assert/strict";
import type { FriendsDataFile } from "../../src/types/friendsConfig";
import {
	applyFriendOperation,
	exportFriendsJson,
	parseFriendsJson,
	validateExternalUrl,
	validateFriendsData,
} from "../../src/utils/friends-data";
import {
	applicationToOperation,
	parseAdminOperation,
	parseFriendApplication,
} from "./issue-form";

const now = "2026-10-26T00:00:00.000Z";
const empty: FriendsDataFile = { version: 1, revision: 0, friends: [] };
const first = applyFriendOperation(
	empty,
	{
		operation: "add",
		friend: {
			id: "example",
			title: "Example",
			siteurl: "https://example.com/",
			imgurl: "https://example.com/logo.png",
			description: "示例",
			tags: ["Blog"],
			weight: 10,
			enabled: true,
		},
	},
	now,
);
assert.equal(first.friends.length, 1, "添加友链");

const edited = applyFriendOperation(
	first,
	{ operation: "update", id: "example", patch: { title: "Edited" } },
	now,
);
assert.equal(edited.friends[0]?.title, "Edited", "编辑友链");

const disabled = applyFriendOperation(
	edited,
	{ operation: "set-enabled", id: "example", enabled: false },
	now,
);
assert.equal(disabled.friends[0]?.enabled, false, "禁用友链");

const second = applyFriendOperation(
	disabled,
	{
		operation: "add",
		friend: {
			id: "second",
			title: "Second",
			siteurl: "https://second.example/",
			imgurl: "",
			description: "",
			tags: [],
			weight: 0,
			enabled: true,
		},
	},
	now,
);
const reordered = applyFriendOperation(
	second,
	{ operation: "reorder", ids: ["second", "example"] },
	now,
);
assert.ok(
	(reordered.friends.find((friend) => friend.id === "second")?.weight || 0) >
		(reordered.friends.find((friend) => friend.id === "example")?.weight || 0),
	"修改显示顺序",
);

assert.throws(
	() =>
		applyFriendOperation(
			second,
			{
				operation: "add",
				friend: {
					id: "duplicate",
					title: "Duplicate",
					siteurl: "http://example.com",
					imgurl: "",
					description: "",
					tags: [],
					weight: 0,
					enabled: true,
				},
			},
			now,
		),
	/网站地址重复/,
	"重复地址校验",
);
assert.ok(validateExternalUrl("javascript:alert(1)"), "危险协议校验");
assert.ok(validateExternalUrl("http://127.0.0.1/admin"), "私网地址校验");
assert.equal(
	validateExternalUrl("https://valid.example/path"),
	null,
	"有效地址校验",
);

const deleted = applyFriendOperation(
	second,
	{ operation: "delete", id: "example" },
	now,
);
assert.equal(deleted.friends.length, 1, "删除友链");

const exported = exportFriendsJson(second);
assert.deepEqual(parseFriendsJson(exported), second, "JSON 导入导出");
assert.equal(
	validateFriendsData(JSON.parse(exported)).valid,
	true,
	"完整数据校验",
);

const replaced = applyFriendOperation(
	second,
	{ operation: "replace", baseRevision: second.revision, data: deleted },
	now,
);
assert.equal(replaced.revision, second.revision + 1, "全量替换递增修订号");
assert.throws(
	() =>
		applyFriendOperation(second, {
			operation: "replace",
			baseRevision: second.revision - 1,
			data: deleted,
		}),
	/友链数据已更新/,
	"过期管理草稿不能覆盖新数据",
);

const applicationBody =
	"### 网站名称\n测试站\n\n### 网站 URL\nhttps://apply.example/\n\n### 网站头像 / Logo URL\nhttps://apply.example/logo.png\n\n### 网站简介\n测试简介\n\n### 网站分类或标签\nBlog, 技术\n\n### 申请说明\n互相学习";
const application = parseFriendApplication(applicationBody);
assert.equal(application.title, "测试站", "访客申请表单解析");
assert.deepEqual(application.tags, ["Blog", "技术"], "申请标签解析");
const approved = applyFriendOperation(
	empty,
	applicationToOperation(application),
	now,
);
assert.equal(
	approved.friends[0]?.siteurl,
	"https://apply.example/",
	"审核转换流程",
);

const adminBody = `### 操作数据（JSON）\n\n${JSON.stringify({ operation: "delete", id: "example" })}`;
assert.deepEqual(
	parseAdminOperation(adminBody),
	{ operation: "delete", id: "example" },
	"管理员操作解析",
);

console.log(
	"友链系统测试通过：添加、编辑、删除、重复/无效 URL、启停、排序、申请解析、审核转换、导入导出。 ",
);
