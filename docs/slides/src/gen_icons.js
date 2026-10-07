const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const sharp = require("sharp");
const fs = require("fs");
const lu = require("react-icons/lu");

const want = {
  user: "LuUserRound", bot: "LuBot", shield: "LuShieldCheck", vault: "LuVault", chain: "LuLink2",
  globe: "LuGlobe", users: "LuUsers", brain: "LuBrain", pen: "LuPenLine", zap: "LuZap",
  fileSig: "LuFileSignature", hash: "LuHash", store: "LuStore", coins: "LuCoins", lock: "LuLock",
  repeat: "LuRepeat", building: "LuBuilding2", eyeOff: "LuEyeOff", alert: "LuTriangleAlert",
  check: "LuCheck", x: "LuX", receipt: "LuReceipt", server: "LuServer", key: "LuKeyRound",
};
const colors = { ink: "#16303A", paper: "#E4ECEF", red: "#B3261E", white: "#FFFFFF", mint: "#6FB08F", guil: "#9DB7C2", redl: "#E0574D" };

(async () => {
  fs.mkdirSync("icons", { recursive: true });
  for (const [k, name] of Object.entries(want)) {
    let C = lu[name];
    if (!C) { console.log("missing", name); continue; }
    for (const [cn, hex] of Object.entries(colors)) {
      const svg = renderToStaticMarkup(React.createElement(C, { size: 256, color: hex, strokeWidth: 1.75 }));
      await sharp(Buffer.from(svg)).resize(256, 256).png().toFile(`icons/${k}-${cn}.png`);
    }
  }
  console.log("ok");
})();
