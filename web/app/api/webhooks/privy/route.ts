import { fail, json } from "@/lib/server/gate";
import { loadLinkedAccounts, privyWebhookConfigured, verifyWebhook } from "@/lib/server/privy";
import { handlePrivyEvent } from "@/lib/server/privyWebhook";
import { getStore } from "@/lib/server/store";

/**
 * Privy's webhook endpoint (ADR 0013). Register `https://<your host>/api/webhooks/privy` under
 * Configuration > Webhooks in the Privy dashboard and subscribe to user.linked_account,
 * user.unlinked_account, user.transferred_account and user.deleted. It keeps shared profiles in
 * step with the owner's linked accounts without waiting for them to open /account.
 *
 * The signature is the only credential, so nothing is read before it checks out. Any 2xx counts as
 * delivered, so events this route has no use for are acknowledged; a failure answers 5xx and Privy
 * retries on its schedule.
 */
export async function POST(request: Request) {
  const store = getStore();
  if (!store || !privyWebhookConfigured) return fail(503, "disabled", "Webhooks are not configured.");

  const event = verifyWebhook(await request.text(), request.headers);
  if (event === null) return fail(401, "bad_signature", "Invalid webhook signature.");

  try {
    const synced = await handlePrivyEvent(event, store, loadLinkedAccounts);
    return json({ ok: true, synced: synced.length });
  } catch {
    return fail(500, "sync_failed", "Could not sync. Privy will retry.");
  }
}
