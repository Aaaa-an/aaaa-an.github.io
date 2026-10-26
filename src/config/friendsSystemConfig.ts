export const friendsSystemConfig = {
	adminGitHubLogin: "Aaaa-an",
	// 计划发布仓库；GitHub 仓库实际创建前，链接可能返回 404，但不会执行任何写入。
	repository: "Aaaa-an/aaaa-an.github.io",
	dataFile: "src/data/friends.json",
	defaultLogo: "/assets/images/mimi/logo.webp",
	applicationTemplate: "04-friend-application.yml",
	adminTemplate: "05-friends-admin.yml",
} as const;
