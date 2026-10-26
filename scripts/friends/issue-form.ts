import type { FriendOperation } from "../../src/utils/friends-data";

export type FriendApplication = {
	title: string;
	siteurl: string;
	imgurl: string;
	description: string;
	tags: string[];
	reason: string;
};

export function parseIssueFormBody(body: string): Record<string, string> {
	const fields: Record<string, string> = {};
	const pattern = /^###\s+(.+?)\s*\r?\n+([\s\S]*?)(?=^###\s+|\s*$)/gm;
	for (const match of body.matchAll(pattern)) {
		const label = match[1]?.trim();
		const rawValue = match[2]?.trim() || "";
		if (!label) continue;
		fields[label] = rawValue === "_No response_" ? "" : rawValue;
	}
	return fields;
}

export function parseFriendApplication(body: string): FriendApplication {
	const fields = parseIssueFormBody(body);
	return {
		title: fields.网站名称 || "",
		siteurl: fields["网站 URL"] || "",
		imgurl: fields["网站头像 / Logo URL"] || "",
		description: fields.网站简介 || "",
		tags: (fields.网站分类或标签 || "")
			.split(/[,，\n]/)
			.map((tag) => tag.trim())
			.filter(Boolean),
		reason: fields.申请说明 || "",
	};
}

export function applicationToOperation(
	application: FriendApplication,
): FriendOperation {
	let hostnameId = "friend";
	try {
		hostnameId =
			new URL(application.siteurl).hostname
				.toLowerCase()
				.replace(/^www\./, "")
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "") || "friend";
	} catch {
		// URL 的具体错误交给统一数据校验器报告。
	}
	return {
		operation: "add",
		friend: {
			id: hostnameId.slice(0, 48),
			title: application.title,
			siteurl: application.siteurl,
			imgurl: application.imgurl,
			description: application.description,
			tags: application.tags,
			weight: 0,
			enabled: true,
		},
	};
}

export function parseAdminOperation(body: string): FriendOperation {
	const fields = parseIssueFormBody(body);
	const payload = fields["操作数据（JSON）"] || "";
	if (!payload) throw new Error("缺少操作数据（JSON）");
	const parsed: unknown = JSON.parse(
		payload.replace(/^```(?:json)?\s*|\s*```$/g, ""),
	);
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!("operation" in parsed)
	) {
		throw new Error("管理操作必须是包含 operation 的 JSON 对象");
	}
	return parsed as FriendOperation;
}
