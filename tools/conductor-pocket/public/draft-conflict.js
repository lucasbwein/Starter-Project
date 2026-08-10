// Resolution flow for a draft conflict: the Mac's Conductor composer already
// holds unsent text, so the relay refused to touch it and handed that text
// back. The user has four real intents at that point, and each one maps to a
// plain sequence over the existing send protocol rather than any new server
// capability:
//
// - replace and send: compare-and-swap the Mac draft with the phone message
//   (replaceDraft + expectedMacDraft, so a draft that changed since the
//   conflict re-conflicts instead of being silently destroyed).
// - send the Mac draft: deliver the Mac's own text as the message. The send
//   script treats a composer whose content equals the message as owned and
//   presses send, so this is "press send on what is sitting there" from the
//   phone. The phone message returns to the composer so nothing is lost and
//   it can be edited before a follow-up send.
// - send the Mac draft, then the phone message: the same, but the phone
//   message stays queued and delivers automatically once the Mac draft is
//   confirmed sent. If the Mac draft fails, the phone message stays put as a
//   retryable failure instead of racing a broken composer.
// - keep the Mac draft: send nothing, return the phone message to the
//   composer.
//
// The flow is a module so the sequencing can be tested without a DOM. All
// state access goes through the injected dependencies.

export function createDraftConflictFlow({
  deliver,
  makeOptimistic,
  insertBefore,
  remove,
  restoreComposer,
  restoreAttachments,
  persist,
  render,
  announce,
}) {
  async function replaceAndSend(message) {
    message.delivery = 'delivering';
    await persist().catch(() => undefined);
    render();
    await deliver(message, {
      replaceDraft: true,
      expectedMacDraft: message.macDraft,
    });
  }

  // Shared by "send the Mac draft" and "send it, then mine". Returns the Mac
  // draft's optimistic entry so callers can check how the send settled.
  async function sendMacDraft(message, { thenPhone = false } = {}) {
    const macText = typeof message.macDraft === 'string' ? message.macDraft : '';
    if (macText.trim() === '') {
      // A conflict only fires on a non-empty composer, so an empty draft is a
      // stale sheet, and a whitespace-only draft would trim server-side to an
      // empty message the relay rejects. Neither can send; put the phone
      // message back where it is safe.
      keepMacDraft(message);
      announce('The Mac composer has nothing to send. Your message is back in the draft.');
      return null;
    }
    const macOptimistic = makeOptimistic(message.sessionId, macText);
    // A re-conflict of this entry must never be presented as "from this
    // phone": its text belongs to the Mac, and pushing it back through the
    // conflict sheet would offer to overwrite the phone composer with it.
    macOptimistic.origin = 'macDraft';
    insertBefore(macOptimistic, message);
    if (thenPhone) {
      message.delivery = 'delivering';
    } else {
      remove(message);
      restoreComposer(message.sessionId, message.text);
      restoreAttachments(message);
    }
    try {
      await persist({ required: true });
    } catch {
      // Secure delivery storage refused the new entry, so the Mac draft send
      // cannot be tracked. Roll the attempt back completely rather than fire
      // an untracked send.
      remove(macOptimistic);
      if (thenPhone) {
        message.delivery = 'failed';
        message.retrySafe = true;
      }
      render();
      announce('Nothing was sent because secure delivery storage was unavailable.');
      return null;
    }
    render();
    // Delivered through the compare-and-swap branch, not the exact-match one:
    // the server trims the outgoing message but never trims expectedMacDraft,
    // so a Mac draft with edge whitespace can never equal its own trimmed self
    // and the exact-match path would re-conflict on the same draft forever.
    // The swap compares the composer against the untrimmed text just read and
    // then sends the trimmed message in its place.
    await deliver(macOptimistic, {
      deliveryIdentityPersisted: true,
      replaceDraft: true,
      expectedMacDraft: macText,
    });
    if (thenPhone) {
      if (macOptimistic.delivery === 'delivered') {
        // The composer emptied when the Mac draft went out, so the queued
        // phone message now sends into a clean composer.
        await deliver(message, {});
      } else {
        // The Mac draft did not confirm. Hold the phone message as a plain
        // retryable failure; sending it now would race whatever state the
        // composer is in, and the Mac draft's own failure handling (retry,
        // or a fresh conflict sheet) is already on screen.
        message.delivery = 'failed';
        message.retrySafe = true;
        await persist().catch(() => undefined);
        render();
        announce('The Mac draft did not confirm, so your message is waiting. Retry it once the Mac draft settles.');
      }
    }
    return macOptimistic;
  }

  function keepMacDraft(message) {
    restoreComposer(message.sessionId, message.text);
    restoreAttachments(message);
    remove(message);
    void persist();
    render();
  }

  return { replaceAndSend, sendMacDraft, keepMacDraft };
}
