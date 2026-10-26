import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const baseURL = process.env.PUBLIC_SMOKE_BASE_URL ?? "http://127.0.0.1:4331";
const outputDir = path.resolve("artifacts-public/smoke");
const browserCandidates = [
	process.env.CHROME_PATH,
	"C:/Program Files/Google/Chrome/Application/chrome.exe",
	"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
	"C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) =>
	existsSync(candidate),
);

if (!executablePath) {
	throw new Error("未找到 Chrome/Edge；可通过 CHROME_PATH 指定浏览器路径。");
}

const routes = [
	"/",
	"/search/",
	"/categories/",
	"/tags/",
	"/friends/",
	"/friends/apply/",
	"/friends/manage/",
	"/dynamic/",
	"/gallery/",
];
const requiredAssets = [
	"/assets/images/mimi/avatar.webp",
	"/assets/images/mimi/logo.webp",
	"/assets/images/effects/sakura.svg",
	"/favicon/mimi-32.png",
	...Array.from(
		{ length: 8 },
		(_, index) =>
			`/assets/images/mimi/wallpapers/desktop-${String(index + 1).padStart(2, "0")}.webp`,
	),
	...Array.from(
		{ length: 8 },
		(_, index) =>
			`/assets/images/mimi/wallpapers/mobile-${String(index + 1).padStart(2, "0")}.webp`,
	),
];
const forbiddenText = [
	"demo-ctf-writeup",
	"demo-learning-log",
	"demo-life-note",
	"demo-technical",
	"demo-project",
	"占位相册",
];
const failures = [];
const results = [];
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
try {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
	});
	const page = await context.newPage();
	page.on("response", (response) => {
		if (response.url().startsWith(baseURL) && response.status() >= 400) {
			failures.push(`${response.status()} ${response.url()}`);
		}
	});

	for (const route of routes) {
		const response = await page.goto(`${baseURL}${route}`, {
			waitUntil: "domcontentloaded",
		});
		await page.waitForTimeout(500);
		const text = await page.locator("body").innerText();
		const matches = forbiddenText.filter((value) => text.includes(value));
		if (!response?.ok())
			failures.push(`${route} HTTP ${response?.status() ?? "none"}`);
		if (matches.length > 0)
			failures.push(`${route} 包含演示内容：${matches.join(", ")}`);
		results.push({
			route,
			status: response?.status() ?? null,
			forbiddenMatches: matches,
		});
		const name =
			route === "/" ? "home" : route.replaceAll("/", "-").replace(/^-|-$/g, "");
		await page.screenshot({
			path: path.join(outputDir, `${name || "home"}-1440x900.png`),
			fullPage: false,
		});
	}

	await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
	await page.locator("#scheme-switch").click();
	const themeItems = page.locator("#theme-mode-panel").getByRole("menuitem");
	if ((await themeItems.count()) !== 3)
		failures.push("亮/暗/系统主题菜单项数量异常");
	else await themeItems.nth(1).click();
	if (
		!(await page
			.locator("html")
			.evaluate((element) => element.classList.contains("dark")))
	) {
		failures.push("深色模式按钮未使 html.dark 生效");
	}
	await page.locator("#display-settings-switch").click();
	const settingsPanel = page.locator("#display-setting");
	if ((await settingsPanel.getAttribute("aria-hidden")) !== "false") {
		failures.push("外观设置面板未打开");
	}
	for (const tabName of ["外观", "壁纸", "特效"]) {
		const tab = settingsPanel.getByRole("button", {
			name: tabName,
			exact: true,
		});
		if ((await tab.count()) !== 1) failures.push(`缺少设置标签：${tabName}`);
		else await tab.click();
	}
	await settingsPanel
		.getByRole("button", { name: "壁纸", exact: true })
		.click();
	const fullscreenButton = settingsPanel.getByRole("button", {
		name: /全屏壁纸/,
	});
	if ((await fullscreenButton.count()) === 1) {
		await fullscreenButton.click();
		const mode = await page.locator("html").getAttribute("data-wallpaper-mode");
		if (mode !== "fullscreen")
			failures.push(`壁纸模式未切换为 fullscreen：${mode}`);
	} else {
		failures.push("缺少全屏壁纸模式按钮");
	}

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
	await page.waitForTimeout(500);
	await page.screenshot({
		path: path.join(outputDir, "home-390x844.png"),
		fullPage: false,
	});

	for (const asset of requiredAssets) {
		const assetResponse = await context.request.get(`${baseURL}${asset}`);
		if (!assetResponse.ok())
			failures.push(`${asset} HTTP ${assetResponse.status()}`);
	}

	const report = {
		baseURL,
		executablePath,
		routes: results,
		failures: [...new Set(failures)],
	};
	await writeFile(
		path.join(outputDir, "result.json"),
		`${JSON.stringify(report, null, 2)}\n`,
		"utf8",
	);
	if (report.failures.length > 0) {
		throw new Error(`公开版冒烟测试失败：\n${report.failures.join("\n")}`);
	}
	console.log(
		`公开版冒烟测试通过：${routes.length} 个页面、桌面与移动端截图、樱花资源。`,
	);
} finally {
	await browser.close();
}
