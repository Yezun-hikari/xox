import { FREEZE_MOVES, WIN_SCORE } from '../../supabase/functions/_shared/rules.ts';

let dialog: HTMLDialogElement | null = null;

export function openRules(): void {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'rules';
    dialog.setAttribute('aria-labelledby', 'rules-title');
    dialog.innerHTML = `
      <form method="dialog" class="rules-inner">
        <h2 id="rules-title">Wie spielt man?</h2>
        <ul>
          <li>Zwei Spieler, <b class="tx">X</b> und <b class="to">O</b>, setzen abwechselnd einen Stein auf das 4×4-Feld.</li>
          <li><b>Vier gleiche</b> in einer Reihe, Spalte oder Diagonale: <b>1 Punkt</b>, die Linie wird geräumt.</li>
          <li>Volle Linie <b>2:2</b>: Die Linie wird geräumt, ohne Punkt.</li>
          <li>Volle Linie <b>3:1</b>: Der einzelne Stein <b>friert ein</b> und zerfällt nach ${FREEZE_MOVES} Zügen. Die Zahl auf dem Stein zeigt, wie viele Züge noch bleiben.</li>
          <li>Ist kein Feld frei, wird der Zug übersprungen.</li>
          <li>Wer zuerst <b>${WIN_SCORE} Punkte</b> hat, gewinnt. Bei der Revanche beginnt der andere Spieler.</li>
        </ul>
        <p class="hint">Steuerung: Tippen oder Klicken – oder Pfeiltasten und Enter.</p>
        <button class="btn primary" value="close" autofocus>Verstanden</button>
      </form>`;
    // Click on the backdrop closes the dialog.
    dialog.addEventListener('click', (e) => e.target === dialog && dialog?.close());
    document.body.append(dialog);
  }
  dialog.showModal();
}
