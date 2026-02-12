/**
 * Gotify notification utilities for user approval workflow
 */

const GOTIFY_URL = process.env.GOTIFY_URL || "http://gotify-service:80";
const GOTIFY_TOKEN = process.env.GOTIFY_TOKEN;
const APP_URL = process.env.APP_URL || "https://chat.sudharsana.dev";

export interface NotificationPayload {
  email: string;
  name?: string | null;
  userId: string;
  createdAt: Date;
}

/**
 * Send a Gotify notification for new user signup
 */
export async function notifyNewUserSignup(payload: NotificationPayload): Promise<boolean> {
  if (!GOTIFY_TOKEN) {
    console.warn("GOTIFY_TOKEN not configured, skipping notification");
    return false;
  }

  const { email, name, userId, createdAt } = payload;
  const approveUrl = `${APP_URL}/api/admin/approve?userId=${userId}&action=approve`;
  const declineUrl = `${APP_URL}/api/admin/approve?userId=${userId}&action=decline`;

  const message = {
    title: "🔔 New User Signup",
    message: `**Email:** ${email}
**Name:** ${name || "Not provided"}
**Time:** ${createdAt.toLocaleString()}

---

[✅ **APPROVE**](${approveUrl})

[❌ **DECLINE**](${declineUrl})`,
    priority: 8,
    extras: {
      "client::display": {
        contentType: "text/markdown"
      },
      "client::notification": {
        click: { url: approveUrl }
      }
    }
  };

  try {
    const response = await fetch(`${GOTIFY_URL}/message?token=${GOTIFY_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      console.error(`Gotify notification failed: ${response.status} ${response.statusText}`);
      return false;
    }

    console.log(`Gotify notification sent for user: ${email}`);
    return true;
  } catch (error) {
    console.error("Failed to send Gotify notification:", error);
    return false;
  }
}

/**
 * Send approval confirmation via Gotify
 */
export async function notifyUserApprovalAction(
  email: string,
  action: "approved" | "declined"
): Promise<boolean> {
  if (!GOTIFY_TOKEN) {
    console.warn("GOTIFY_TOKEN not configured, skipping notification");
    return false;
  }

  const emoji = action === "approved" ? "✓" : "✗";

  try {
    const response = await fetch(`${GOTIFY_URL}/message?token=${GOTIFY_TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `User ${action}`,
        message: `${emoji} ${email} has been ${action}`,
        priority: 5
      }),
    });

    return response.ok;
  } catch (error) {
    console.error("Failed to send Gotify approval notification:", error);
    return false;
  }
}
