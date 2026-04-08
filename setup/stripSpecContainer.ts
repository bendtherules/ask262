#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";

/**
 * Strips HTML files to only contain the #spec-container element.
 *
 * This script processes HTML files in the spec-built/multipage directory,
 * extracts the #spec-container element, and replaces the entire body
 * content with just that container. This reduces file size and focuses
 * only on the specification content.
 */

const SPEC_DIR = path.join(__dirname, "../spec-built/multipage");

function stripSpecContainer(): void {
  const files = fs.readdirSync(SPEC_DIR);
  let processedCount = 0;

  for (const file of files) {
    if (!file.endsWith(".html")) {
      continue;
    }

    const filePath = path.join(SPEC_DIR, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const $ = cheerio.load(content);
    const container = $("#spec-container");

    if (container.length) {
      $("body").empty().append(container);
      fs.writeFileSync(filePath, $.html());
      console.log(`Processed ${file}`);
      processedCount++;
    } else {
      console.warn(`Warning: #spec-container not found in ${file}`);
    }
  }

  console.log(`\nProcessed ${processedCount} HTML file(s)`);
}

stripSpecContainer();
