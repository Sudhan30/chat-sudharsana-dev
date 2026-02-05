/**
 * Script to approve a user by email
 * Usage: bun run scripts/approve-user.ts <email>
 */

import { approveUserByEmail } from "../src/lib/db";

const email = process.argv[2];

if (!email) {
  console.error("Usage: bun run scripts/approve-user.ts <email>");
  process.exit(1);
}

async function main() {
  console.log(`Approving user: ${email}`);

  const user = await approveUserByEmail(email);

  if (user) {
    console.log(`✅ User ${user.email} has been approved!`);
    console.log(`   User ID: ${user.id}`);
    console.log(`   Name: ${user.name || "Not set"}`);
  } else {
    console.error(`❌ User with email ${email} not found`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
