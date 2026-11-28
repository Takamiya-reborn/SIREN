// ASTCBIN 容器纯逻辑单测：packAstcTexture 产出 -> parseAstcBin 解析 round-trip、
// 魔数嗅探、截断/非法输入拒绝。全合成数据，不依赖真实资产。
import { suite } from "../helpers/suite.mjs";
import { packAstcTexture, readAstcRaw } from "../../extract/texture.js";
import {
  ASTCBIN_HEADER_SIZE,
  isAstcBin,
  parseAstcBin,
  parseAstcBinHeader,
} from "../../../src/mobile/astcBin.js";

const { check, eq, section, finish } = suite("ASTCBIN 容器");

// readAstcRaw 输入：合成 ASTC 块（块行序自底向上，2 块行）
const blocksX = 3;
const blocksY = 2;
const bw = 8;
const bh = 8;
const rawIn = new Uint8Array(blocksX * blocksY * 16).map((_, i) => i & 0xff);

const raw = readAstcRaw(
  {
    name: "tex",
    textureFormat: "ASTC_RGB_8x8",
    width: blocksX * bw,
    height: blocksY * bh,
    data: rawIn,
  },
  null,
);

section("packAstcTexture -> parseAstcBin round-trip");
const packed = packAstcTexture(raw);
check("魔数 ASTCBIN 命中", isAstcBin(packed));
const parsed = parseAstcBin(packed);
eq("width", parsed.width, blocksX * bw);
eq("height", parsed.height, blocksY * bh);
eq("blockWidth", parsed.blockWidth, 8);
eq("blockHeight", parsed.blockHeight, 8);
eq("块数据长度", parsed.data.length, packed.length - ASTCBIN_HEADER_SIZE);
// flip=true：块行逆序重排（Unity 自底向上 -> top-down），解析端原样透出
for (let by = 0; by < blocksY; by++) {
  const src = (blocksY - 1 - by) * blocksX * 16;
  for (let i = 0; i < blocksX * 16; i++) {
    eq(`块行 ${by} 字节 ${i}`, parsed.data[by * blocksX * 16 + i], src + i);
  }
}

section("头部字段布局（对齐：magic 7 字节 + 补齐，width@8）");
eq("补齐字节", packed[7], 0);
eq("u32 width @8", parseAstcBinHeader(packed).width, blocksX * bw);

section("非法输入拒绝");
check(!isAstcBin(new Uint8Array(0)), "空字节不命中");
check(!isAstcBin(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), "PNG 魔数不命中");
check(!isAstcBin(packed.subarray(0, 5)), "魔数截断不命中");
let threw = "";
try {
  parseAstcBinHeader(packed.subarray(0, 10));
} catch (e) {
  threw = e.message;
}
check(threw.includes("头不完整"), "头部截断拒绝");
threw = "";
try {
  const bad = packed.slice();
  bad[0] = 0x00;
  parseAstcBin(bad);
} catch (e) {
  threw = e.message;
}
check(threw.includes("魔数不符"), "魔数篡改拒绝");
threw = "";
try {
  parseAstcBin(packed.subarray(0, packed.length - 4));
} catch (e) {
  threw = e.message;
}
check(threw.includes("块数不符"), "块数据截断拒绝");

finish();
