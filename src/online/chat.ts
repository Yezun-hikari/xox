import { checkChat } from '../shared/profanity.ts';
import { getClient } from '@yezun/konto';
import { announce } from '../ui/announce.ts';
import { play } from '../ui/sound.ts';
import { ApiError, call, chatErrorText, setMsg } from './api.ts';

const POLL_MS = 1500; // Realtime is unavailable on the hosted project
const DESKTOP = '(min-width: 900px)'; // same breakpoint as the chat block in style.css

interface Message {
  id: number;
  sender_id: string;
  body: string;
  created_at: string;
}

export interface Chat {
  setClosed(closed: boolean): void;
  destroy(): void;
}

/** Message bodies and nicknames are untrusted: they only ever go through textContent. */
export function createChat(
  container: HTMLElement,
  { matchId, userId, opponentNick }: { matchId: string; userId: string; opponentNick: string },
): Chat {
  const root = document.createElement('aside');
  root.className = 'chat';
  root.innerHTML = `
    <button class="chat-fab" type="button">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>
      <span class="chat-badge" aria-hidden="true" hidden></span>
    </button>
    <div class="chat-panel">
      <div class="chat-head">
        <h2 class="chat-title"></h2>
        <button class="chat-mute" type="button" aria-pressed="false">Stummschalten</button>
        <button class="icon-btn chat-close" type="button" aria-label="Chat schließen">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="chat-list" role="log" aria-live="polite" aria-label="Nachrichten" tabindex="0"></div>
      <p class="chat-note" data-mute-note hidden></p>
      <p class="chat-note" data-closed-note hidden>Der Chat ist geschlossen. Der Verlauf bleibt lesbar.</p>
      <p class="msg chat-error" role="status"></p>
      <form class="chat-form" novalidate>
        <label class="sr-only" for="chat-input"></label>
        <input id="chat-input" maxlength="200" autocomplete="off" enterkeyhint="send">
        <button class="btn primary" type="submit">Senden</button>
      </form>
    </div>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const fab = $<HTMLButtonElement>('.chat-fab');
  const badge = $('.chat-badge');
  const panel = $('.chat-panel');
  const mute = $<HTMLButtonElement>('.chat-mute');
  const closeBtn = $<HTMLButtonElement>('.chat-close');
  const list = $('.chat-list');
  const muteNote = $('[data-mute-note]');
  const closedNote = $('[data-closed-note]');
  const error = $('.chat-error');
  const form = $<HTMLFormElement>('.chat-form');
  const input = $<HTMLInputElement>('input');
  const send = $<HTMLButtonElement>('.chat-form button');

  $('.chat-title').textContent = opponentNick;
  $('label').textContent = `Nachricht an ${opponentNick}`;
  panel.setAttribute('aria-label', `Chat mit ${opponentNick}`);
  muteNote.textContent = `Neue Nachrichten von ${opponentNick} werden ausgeblendet.`;
  container.classList.add('has-chat');
  container.append(root);

  const seen = new Set<number>();
  const desktop = matchMedia(DESKTOP);
  const vv = window.visualViewport;
  let lastId = 0;
  let unread = 0;
  let muted = false;
  let closed = false;
  let gone = false;
  let polling = false;
  let sending = false;
  let loaded = false; // what the first fetch finds is history: no sound, no badge
  let pinned = true;
  let timer = 0;

  const isOpen = () => root.classList.contains('open');

  function paintBadge(): void {
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    fab.setAttribute('aria-label', unread ? `Chat öffnen, ${unread} ungelesen` : 'Chat öffnen');
  }

  function add(m: Message): void {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    const mine = m.sender_id === userId;
    if (!mine && muted) return;
    const row = document.createElement('div');
    row.className = mine ? 'chat-msg mine' : 'chat-msg';
    row.dataset.id = String(m.id);
    const who = document.createElement('span');
    who.className = 'sr-only';
    who.textContent = `${mine ? 'Du' : opponentNick}: `;
    row.append(who, document.createTextNode(m.body));
    // by id: an opponent's message can arrive after our own later one, whose id came from the send response
    const next = [...list.children].find((c) => Number((c as HTMLElement).dataset.id) > m.id);
    list.insertBefore(row, next ?? null);
    if (mine || pinned) list.scrollTop = list.scrollHeight;
    if (mine || !loaded) return;
    play('message');
    if (!desktop.matches && !isOpen()) {
      unread++;
      paintBadge();
      announce(`Neue Chat-Nachricht von ${opponentNick}.`);
    }
  }

  // shortcut: an id committed after a higher one was polled is missed; needs concurrent senders within milliseconds
  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    const { data, error: err } = await getClient()
      .from('match_messages')
      .select('id,sender_id,body,created_at')
      .eq('match_id', matchId)
      .gt('id', lastId)
      .order('id');
    polling = false;
    if (gone || err) return;
    for (const m of data as Message[]) {
      lastId = m.id; // not from the send response: that could skip an opponent message with a lower id
      add(m);
    }
    loaded = true;
  }

  function setClosed(next: boolean): void {
    if (next === closed) return;
    if (next && form.contains(document.activeElement)) (desktop.matches ? mute : closeBtn).focus();
    closed = next;
    form.hidden = next;
    closedNote.hidden = !next;
    if (next) setMsg(error, '', false);
    clearInterval(timer);
    void poll();
    if (!next) timer = window.setInterval(poll, POLL_MS);
  }

  function open(): void {
    root.classList.add('open');
    unread = 0;
    paintBadge();
    list.scrollTop = list.scrollHeight;
    (closed ? closeBtn : input).focus();
  }

  function close(): void {
    root.classList.remove('open');
    fab.focus();
  }

  /** The panel is a dialog only as the mobile popup. */
  function applyLayout(): void {
    root.classList.remove('open');
    unread = 0;
    paintBadge();
    panel.setAttribute('role', desktop.matches ? 'region' : 'dialog');
    if (desktop.matches) panel.removeAttribute('aria-modal');
    else panel.setAttribute('aria-modal', 'true');
  }

  // The on-screen keyboard shrinks only the visual viewport: keep the popup above it.
  function fitViewport(): void {
    if (!vv) return;
    root.style.setProperty('--chat-vh', `${vv.height}px`);
    root.style.setProperty('--chat-kb', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
  }

  function onKey(e: KeyboardEvent): void {
    if (!isOpen() || document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const items = [...panel.querySelectorAll<HTMLElement>('button, input, [tabindex]')].filter((el) => el.offsetParent);
      const target = e.shiftKey ? items[0] : items[items.length - 1];
      const active = document.activeElement as HTMLElement;
      if (active === target || !panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? items[items.length - 1] : items[0]).focus();
      }
    }
  }

  fab.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  list.addEventListener('scroll', () => {
    pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
  });
  mute.addEventListener('click', () => {
    muted = !muted;
    mute.setAttribute('aria-pressed', String(muted));
    muteNote.hidden = !muted;
  });
  // keep focus (and the on-screen keyboard) in the input when tapping Senden
  send.addEventListener('mousedown', (e) => e.preventDefault());

  input.addEventListener('input', () => {
    const r = checkChat(input.value);
    const bad = !r.ok && r.reason !== 'empty';
    setMsg(error, bad ? chatErrorText(new ApiError(r.reason)) : '', bad);
    input.setAttribute('aria-invalid', String(bad));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending || closed) return;
    const r = checkChat(input.value);
    if (!r.ok) {
      if (r.reason !== 'empty') setMsg(error, chatErrorText(new ApiError(r.reason)), true);
      return;
    }
    const typed = input.value;
    sending = true;
    try {
      const { message } = await call<{ message: Message }>('chat-send', { matchId, text: r.text });
      if (gone) return;
      if (input.value === typed) input.value = ''; // keep what was typed while the request ran
      setMsg(error, '', false);
      input.setAttribute('aria-invalid', 'false');
      add(message);
    } catch (err) {
      if (gone) return;
      setMsg(error, chatErrorText(err), true);
      if (err instanceof ApiError && err.code === 'chat_closed') setClosed(true);
    } finally {
      sending = false;
    }
  });

  // keyboard, notes and error messages shrink the list: keep the newest message in view
  const keepPinned = new ResizeObserver(() => {
    if (pinned) list.scrollTop = list.scrollHeight;
  });
  keepPinned.observe(list);

  document.addEventListener('keydown', onKey);
  desktop.addEventListener('change', applyLayout);
  vv?.addEventListener('resize', fitViewport);
  vv?.addEventListener('scroll', fitViewport);

  applyLayout();
  fitViewport();
  void poll();
  timer = window.setInterval(poll, POLL_MS);

  return {
    setClosed,
    destroy() {
      gone = true;
      clearInterval(timer);
      keepPinned.disconnect();
      document.removeEventListener('keydown', onKey);
      desktop.removeEventListener('change', applyLayout);
      vv?.removeEventListener('resize', fitViewport);
      vv?.removeEventListener('scroll', fitViewport);
      container.classList.remove('has-chat');
      root.remove();
    },
  };
}
