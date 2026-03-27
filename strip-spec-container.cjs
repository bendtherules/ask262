const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const dir = path.join(__dirname, "spec-built/multipage");
fs.readdirSync(dir).forEach((file) => {
  if (!file.endsWith(".html")) return;
  const filePath = path.join(dir, file);
  const content = fs.readFileSync(filePath, "utf-8");
  const $ = cheerio.load(content);
  const container = $("#spec-container");
  if (container.length) {
    $("body").empty().append(container);
    fs.writeFileSync(filePath, $.html());
    console.log(`Processed ${file}`);
  }
});
