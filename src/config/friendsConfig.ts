import friendsData from "@/data/friends.json";
import {
	assertFriendsData,
	sortFriendRecords,
	toFriendLink,
} from "@/utils/friends-data";
import type {
	FriendLink,
	FriendsDataFile,
	FriendsPageConfig,
} from "../types/friendsConfig";
import { friendsSystemConfig } from "./friendsSystemConfig";

// 可以在src/content/spec/friends.md中编写友链页面下方的自定义内容

// 友链页面配置
export const friendsPageConfig: FriendsPageConfig = {
	// 页面标题，如果留空则使用 i18n 中的翻译
	title: "友链",

	// 页面描述文本，如果留空则使用 i18n 中的翻译
	description: "在这里认识朋友们的网站，也可以通过 GitHub 提交友链申请。",

	// 是否显示底部自定义内容（friends.mdx 中的内容）
	showCustomContent: true,

	// 是否显示评论区，需要先在commentConfig.ts启用评论系统
	showComment: false,

	// 是否开启随机排序配置，如果开启，就会忽略权重，构建时进行一次随机排序
	randomizeSort: false,
};

assertFriendsData(friendsData);
const validatedFriendsData: FriendsDataFile = friendsData;

// 兼容 Firefly 原组件：真实数据保存在 src/data/friends.json，构建时映射为旧 FriendLink。
export const friendsConfig: FriendLink[] = validatedFriendsData.friends.map(
	(friend) => toFriendLink(friend, friendsSystemConfig.defaultLogo),
);

// 获取启用的友链并进行排序
export const getEnabledFriends = (): FriendLink[] => {
	const friends = friendsConfig.filter((friend) => friend.enabled);

	if (friendsPageConfig.randomizeSort) {
		return friends.sort(() => Math.random() - 0.5);
	}

	return sortFriendRecords(
		validatedFriendsData.friends.filter((friend) => friend.enabled),
	).map((friend) => toFriendLink(friend, friendsSystemConfig.defaultLogo));
};
