import type { SponsorConfig } from "../types/sponsorConfig";

// 打赏页面默认关闭；这里不保留上游作者的收款方式或虚构打赏记录。
export const sponsorConfig: SponsorConfig = {
	title: "",
	description: "",
	usage: "",
	showSponsorsList: false,
	showComment: false,
	showButtonInPost: false,
	methods: [],
	sponsors: [],
};
