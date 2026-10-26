import type {
	FriendLink,
	FriendRecord,
	FriendsDataFile,
} from "@/types/friendsConfig";

export type FriendValidationIssue = {
	path: string;
	message: string;
};

export type FriendValidationResult = {
	valid: boolean;
	errors: FriendValidationIssue[];
};

export type FriendOperation =
	| { operation: "add"; friend: Partial<FriendRecord> }
	| { operation: "update"; id: string; patch: Partial<FriendRecord> }
	| { operation: "delete"; id: string }
	| { operation: "set-enabled"; id: string; enabled: boolean }
	| { operation: "reorder"; ids: string[] }
	| { operation: "replace"; baseRevision: number; data: unknown };

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const HTML_PATTERN = /[<>]/;

function hasUnsafeControlCharacters(value: string): boolean {
	return [...value].some((character) => {
		const code = character.charCodeAt(0);
		return (
			(code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127
		);
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrivateIpv4(hostname: string): boolean {
	const parts = hostname.split(".").map(Number);
	if (
		parts.length !== 4 ||
		parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
	) {
		return false;
	}
	const [a, b] = parts;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		a >= 224
	);
}

export function isPublicHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (
		normalized === "localhost" ||
		normalized.endsWith(".localhost") ||
		normalized.endsWith(".local") ||
		normalized.endsWith(".internal") ||
		normalized === "::1" ||
		normalized.startsWith("fe80:") ||
		normalized.startsWith("fc") ||
		normalized.startsWith("fd")
	) {
		return false;
	}
	return !isPrivateIpv4(normalized);
}

export function validateExternalUrl(
	value: string,
	options: { allowLocalPath?: boolean } = {},
): string | null {
	if (options.allowLocalPath && value.startsWith("/")) {
		if (
			value.startsWith("//") ||
			value.includes("..") ||
			value.includes("\\")
		) {
			return "本地资源路径不合法";
		}
		return null;
	}

	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return "不是有效 URL";
	}
	if (!["http:", "https:"].includes(parsed.protocol)) {
		return "只允许 http 或 https 协议";
	}
	if (parsed.username || parsed.password) {
		return "URL 不允许包含用户名或密码";
	}
	if (!isPublicHostname(parsed.hostname)) {
		return "URL 不允许指向本机、私网或保留地址";
	}
	return null;
}

function validateText(
	value: unknown,
	path: string,
	errors: FriendValidationIssue[],
	options: { required?: boolean; maxLength: number },
): void {
	if (typeof value !== "string") {
		errors.push({ path, message: "必须是字符串" });
		return;
	}
	const trimmed = value.trim();
	if (options.required && !trimmed) {
		errors.push({ path, message: "不能为空" });
	}
	if (trimmed.length > options.maxLength) {
		errors.push({ path, message: `不能超过 ${options.maxLength} 个字符` });
	}
	if (hasUnsafeControlCharacters(trimmed) || HTML_PATTERN.test(trimmed)) {
		errors.push({ path, message: "不能包含控制字符或 HTML 标签" });
	}
}

function validateIsoDate(
	value: unknown,
	path: string,
	errors: FriendValidationIssue[],
): void {
	if (typeof value !== "string" || !value || Number.isNaN(Date.parse(value))) {
		errors.push({ path, message: "必须是有效的 ISO 日期时间" });
	}
}

export function canonicalSiteKey(value: string): string {
	const parsed = new URL(value);
	const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
	return `${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ""}${pathname}`;
}

export function validateFriendsData(value: unknown): FriendValidationResult {
	const errors: FriendValidationIssue[] = [];
	if (!isRecord(value)) {
		return {
			valid: false,
			errors: [{ path: "$", message: "根节点必须是对象" }],
		};
	}
	if (value.version !== 1) {
		errors.push({ path: "version", message: "当前只支持版本 1" });
	}
	if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) {
		errors.push({ path: "revision", message: "必须是非负安全整数" });
	}
	if (!Array.isArray(value.friends)) {
		errors.push({ path: "friends", message: "必须是数组" });
		return { valid: false, errors };
	}

	const ids = new Set<string>();
	const siteKeys = new Set<string>();
	value.friends.forEach((friend, index) => {
		const base = `friends[${index}]`;
		if (!isRecord(friend)) {
			errors.push({ path: base, message: "必须是对象" });
			return;
		}
		validateText(friend.id, `${base}.id`, errors, {
			required: true,
			maxLength: 64,
		});
		if (typeof friend.id === "string") {
			if (!ID_PATTERN.test(friend.id)) {
				errors.push({
					path: `${base}.id`,
					message: "仅允许小写字母、数字和连字符",
				});
			}
			if (ids.has(friend.id)) {
				errors.push({ path: `${base}.id`, message: "id 重复" });
			}
			ids.add(friend.id);
		}
		validateText(friend.title, `${base}.title`, errors, {
			required: true,
			maxLength: 80,
		});
		validateText(friend.description, `${base}.description`, errors, {
			maxLength: 200,
		});

		if (typeof friend.siteurl !== "string") {
			errors.push({ path: `${base}.siteurl`, message: "必须是字符串" });
		} else {
			const urlError = validateExternalUrl(friend.siteurl);
			if (urlError) {
				errors.push({ path: `${base}.siteurl`, message: urlError });
			} else {
				const key = canonicalSiteKey(friend.siteurl);
				if (siteKeys.has(key)) {
					errors.push({ path: `${base}.siteurl`, message: "网站地址重复" });
				}
				siteKeys.add(key);
			}
		}

		if (typeof friend.imgurl !== "string") {
			errors.push({ path: `${base}.imgurl`, message: "必须是字符串" });
		} else if (friend.imgurl) {
			const imageError = validateExternalUrl(friend.imgurl, {
				allowLocalPath: true,
			});
			if (imageError)
				errors.push({ path: `${base}.imgurl`, message: imageError });
		}

		if (!Array.isArray(friend.tags)) {
			errors.push({ path: `${base}.tags`, message: "必须是字符串数组" });
		} else {
			if (friend.tags.length > 8) {
				errors.push({ path: `${base}.tags`, message: "最多允许 8 个标签" });
			}
			const normalizedTags = new Set<string>();
			friend.tags.forEach((tag, tagIndex) => {
				validateText(tag, `${base}.tags[${tagIndex}]`, errors, {
					required: true,
					maxLength: 24,
				});
				if (typeof tag === "string") {
					const normalized = tag.trim().toLowerCase();
					if (normalizedTags.has(normalized)) {
						errors.push({
							path: `${base}.tags[${tagIndex}]`,
							message: "标签重复",
						});
					}
					normalizedTags.add(normalized);
				}
			});
		}

		if (
			!Number.isInteger(friend.weight) ||
			Number(friend.weight) < -10000 ||
			Number(friend.weight) > 10000
		) {
			errors.push({
				path: `${base}.weight`,
				message: "必须是 -10000 到 10000 之间的整数",
			});
		}
		if (typeof friend.enabled !== "boolean") {
			errors.push({ path: `${base}.enabled`, message: "必须是布尔值" });
		}
		validateIsoDate(friend.createdAt, `${base}.createdAt`, errors);
		validateIsoDate(friend.updatedAt, `${base}.updatedAt`, errors);
	});

	return { valid: errors.length === 0, errors };
}

export function assertFriendsData(
	value: unknown,
): asserts value is FriendsDataFile {
	const result = validateFriendsData(value);
	if (!result.valid) {
		throw new Error(
			`友链数据校验失败:\n${result.errors.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n")}`,
		);
	}
}

export function sortFriendRecords(records: FriendRecord[]): FriendRecord[] {
	return [...records].sort(
		(a, b) => b.weight - a.weight || a.title.localeCompare(b.title, "zh-CN"),
	);
}

export function toFriendLink(
	record: FriendRecord,
	defaultLogo: string,
): FriendLink {
	return {
		id: record.id,
		title: record.title,
		imgurl: record.imgurl || defaultLogo,
		desc: record.description,
		siteurl: record.siteurl,
		tags: [...record.tags],
		weight: record.weight,
		enabled: record.enabled,
	};
}

export function parseFriendsJson(text: string): FriendsDataFile {
	const value: unknown = JSON.parse(text);
	assertFriendsData(value);
	return structuredClone(value);
}

export function exportFriendsJson(data: FriendsDataFile): string {
	assertFriendsData(data);
	return `${JSON.stringify(data, null, 2)}\n`;
}

function slugifyId(title: string): string {
	const slug = title
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return slug || "friend";
}

function uniqueId(base: string, records: FriendRecord[]): string {
	const ids = new Set(records.map((friend) => friend.id));
	if (!ids.has(base)) return base;
	let suffix = 2;
	while (ids.has(`${base}-${suffix}`)) suffix += 1;
	return `${base}-${suffix}`;
}

export function applyFriendOperation(
	current: FriendsDataFile,
	operation: FriendOperation,
	now: string = new Date().toISOString(),
): FriendsDataFile {
	assertFriendsData(current);
	if (operation.operation === "replace") {
		if (operation.baseRevision !== current.revision) {
			throw new Error(
				`友链数据已更新：管理草稿基于修订 ${operation.baseRevision}，当前修订为 ${current.revision}。请刷新管理页后重新应用变更。`,
			);
		}
		assertFriendsData(operation.data);
		const replacement = structuredClone(operation.data);
		replacement.revision = current.revision + 1;
		assertFriendsData(replacement);
		return replacement;
	}

	const next = structuredClone(current);
	if (operation.operation === "add") {
		const title = String(operation.friend.title || "").trim();
		const id = uniqueId(
			String(operation.friend.id || slugifyId(title)),
			next.friends,
		);
		next.friends.push({
			id,
			title,
			siteurl: String(operation.friend.siteurl || "").trim(),
			imgurl: String(operation.friend.imgurl || "").trim(),
			description: String(operation.friend.description || "").trim(),
			tags: Array.isArray(operation.friend.tags)
				? operation.friend.tags.map((tag) => String(tag).trim()).filter(Boolean)
				: [],
			weight: Number.isInteger(operation.friend.weight)
				? Number(operation.friend.weight)
				: 0,
			enabled: operation.friend.enabled !== false,
			createdAt: operation.friend.createdAt || now,
			updatedAt: now,
		});
	} else if (operation.operation === "update") {
		const index = next.friends.findIndex(
			(friend) => friend.id === operation.id,
		);
		if (index < 0) throw new Error(`找不到友链: ${operation.id}`);
		next.friends[index] = {
			...next.friends[index],
			...operation.patch,
			id: operation.id,
			updatedAt: now,
		};
	} else if (operation.operation === "delete") {
		const before = next.friends.length;
		next.friends = next.friends.filter((friend) => friend.id !== operation.id);
		if (next.friends.length === before)
			throw new Error(`找不到友链: ${operation.id}`);
	} else if (operation.operation === "set-enabled") {
		const friend = next.friends.find((item) => item.id === operation.id);
		if (!friend) throw new Error(`找不到友链: ${operation.id}`);
		friend.enabled = operation.enabled;
		friend.updatedAt = now;
	} else if (operation.operation === "reorder") {
		if (
			operation.ids.length !== next.friends.length ||
			new Set(operation.ids).size !== next.friends.length ||
			operation.ids.some(
				(id) => !next.friends.some((friend) => friend.id === id),
			)
		) {
			throw new Error("排序列表必须完整且不能包含重复 id");
		}
		const total = operation.ids.length;
		operation.ids.forEach((id, index) => {
			const friend = next.friends.find((item) => item.id === id);
			if (friend) {
				friend.weight = (total - index) * 10;
				friend.updatedAt = now;
			}
		});
	} else {
		throw new Error("未知的友链管理操作");
	}

	next.revision = current.revision + 1;
	assertFriendsData(next);
	return next;
}
