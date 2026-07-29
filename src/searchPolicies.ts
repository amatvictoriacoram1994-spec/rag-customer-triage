import "dotenv/config";
import { retrievePolicies } from "./retrievePolicies.js";

async function search(): Promise<void> {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) throw new Error('Usage: npm run search -- "your customer question"');
  const results = await retrievePolicies(query, 5);
  if (!results.length) return void console.log("No matching policy chunks found.");
  results.forEach((result, index) => {
    const preview = result.content.length > 300 ? `${result.content.slice(0, 300)}…` : result.content;
    console.log(`\n${index + 1}. ${result.document_title} (v${result.document_version})`);
    console.log(`   Section ${result.section_number}: ${result.section_title}`);
    console.log(`   Similarity: ${Number(result.similarity).toFixed(4)}`);
    console.log(`   ${preview.replace(/\s+/g, " ")}`);
  });
}

search().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
