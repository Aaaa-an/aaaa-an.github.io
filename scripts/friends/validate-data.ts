import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertFriendsData } from "../../src/utils/friends-data";

const dataPath = resolve("src/data/friends.json");
const data: unknown = JSON.parse(await readFile(dataPath, "utf8"));
assertFriendsData(data);
console.log(`友链数据校验通过：${data.friends.length} 条记录。`);
