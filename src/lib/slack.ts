/**
 * Slack notification utilities for user approval workflow
 */

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const APP_URL = process.env.APP_URL || "https://chat.sudharsana.dev";

export interface SlackNotificationPayload {
  email: string;
  name?: string | null;
  userId: string;
  createdAt: Date;
}

/**
 * Send a Slack notification for new user signup
 */
export async function notifyNewUserSignup(payload: SlackNotificationPayload): Promise<boolean> {
  if (!SLACK_WEBHOOK_URL) {
    console.warn("SLACK_WEBHOOK_URL not configured, skipping notification");
    return false;
  }

  const { email, name, userId, createdAt } = payload;

  const message = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "New User Signup Request",
          emoji: true
        }
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Email:*\n${email}`
          },
          {
            type: "mrkdwn",
            text: `*Name:*\n${name || "Not provided"}`
          },
          {
            type: "mrkdwn",
            text: `*User ID:*\n\`${userId}\``
          },
          {
            type: "mrkdwn",
            text: `*Signed up:*\n${createdAt.toLocaleString()}`
          }
        ]
      },
      {
        type: "divider"
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Approve",
              emoji: true
            },
            style: "primary",
            url: `${APP_URL}/api/admin/approve?userId=${userId}&action=approve`
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Decline",
              emoji: true
            },
            style: "danger",
            url: `${APP_URL}/api/admin/approve?userId=${userId}&action=decline`
          }
        ]
      }
    ]
  };

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      console.error(`Slack notification failed: ${response.status} ${response.statusText}`);
      return false;
    }

    console.log(`Slack notification sent for user: ${email}`);
    return true;
  } catch (error) {
    console.error("Failed to send Slack notification:", error);
    return false;
  }
}

/**
 * Send approval confirmation to Slack
 */
export async function notifyUserApprovalAction(
  email: string,
  action: "approved" | "declined"
): Promise<boolean> {
  if (!SLACK_WEBHOOK_URL) {
    console.warn("SLACK_WEBHOOK_URL not configured, skipping notification");
    return false;
  }

  const emoji = action === "approved" ? ":white_check_mark:" : ":x:";
  const message = {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} User *${email}* has been *${action}*`
        }
      }
    ]
  };

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    return response.ok;
  } catch (error) {
    console.error("Failed to send Slack approval notification:", error);
    return false;
  }
}
