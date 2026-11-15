/* TEMPORARY chat demo: scripted replies with made-up data, no backend.
   Remove this file, chat-demo.css and the two <!-- chat-demo --> lines in index.html. */
(function () {
  'use strict';

  var SERVICES = ['Knippen (inclusief baard)', 'Contour', 'Baard trimmen', 'Knipbeurt kids (tot 11 jaar)'];
  var HOURS = { 1: [11, 20], 2: [11, 20], 3: [11, 20], 4: [11, 20], 5: [11, 19], 6: [10, 13] };

  var TXT = {
    nl: {
      launch: 'Chat met Fresh', title: 'Fresh', status: 'Assistent van Fresh Fadez Studios',
      note: '<b>Demo.</b> Virtuele assistent (AI). Antwoorden zijn voorbeelden.',
      placeholder: 'Typ je bericht…', send: 'Verstuur', close: 'Sluit chat', open: 'Chat met Fresh',
      welcome: 'Hoi! Ik ben Fresh, de virtuele assistent van Fresh Fadez Studios. Ik kan je afspraak verplaatsen, annuleren of een andere behandeling kiezen. Waar kan ik je mee helpen?',
      menu: ['Afspraak verplaatsen', 'Afspraak annuleren', 'Andere behandeling', 'Openingstijden'],
      askRef: 'Prima. Wat is je referentie (bijv. FF-4821) en het telefoonnummer waarmee je hebt geboekt?',
      found: 'Ik heb je afspraak gevonden:',
      apt: 'Jouw afspraak', svc: 'Behandeling', when: 'Wanneer', ref: 'Referentie',
      pickTime: 'Welk moment past je beter? Dit is nog vrij:',
      moved: 'Afspraak verplaatst', movedMsg: 'Klaar! Je krijgt de bevestiging ook per e-mail.',
      askCancel: 'Weet je zeker dat je deze afspraak wilt annuleren?', yes: 'Ja, annuleren', no: 'Nee, toch niet',
      cancelled: 'Afspraak geannuleerd', cancelledMsg: 'Je afspraak is geannuleerd. Hopelijk tot snel!',
      kept: 'Geen probleem, je afspraak blijft staan.',
      pickSvc: 'Welke behandeling wil je in plaats daarvan?',
      changed: 'Behandeling gewijzigd', changedMsg: 'Aangepast! De tijd blijft hetzelfde.',
      hours: 'We zijn open:\nMa–Do 11:00–21:00\nVr 11:00–20:00\nZa 10:00–14:00\nZo gesloten',
      prices: 'Knippen (inclusief baard) € 25,00\nContour € 12,50\nBaard trimmen € 12,50\nKnipbeurt kids € 20,00\n\nOnline betaal je € 1,50 reserveringskosten, de rest in de zaak.',
      human: 'Ik ben Fresh, een virtuele assistent en geen mens. Wil je de kapper zelf spreken? Bel 06 86 38 64 17.',
      late: 'Let op: binnen 24 uur voor je afspraak kan ik niets meer wijzigen. Bel dan even naar de zaak.',
      fallback: 'Dat begrijp ik nog niet helemaal. Kies een van deze opties:',
      more: 'Kan ik nog ergens anders mee helpen?', thanks: 'Graag gedaan! Fijne dag.',
      newTime: 'Nieuw', old: 'Was'
    },
    en: {
      launch: 'Chat with Fresh', title: 'Fresh', status: 'Fresh Fadez Studios assistant',
      note: '<b>Demo.</b> Virtual assistant (AI). Replies are examples.',
      placeholder: 'Type your message…', send: 'Send', close: 'Close chat', open: 'Chat with Fresh',
      welcome: 'Hi! I am Fresh, the virtual assistant of Fresh Fadez Studios. I can move or cancel your appointment, or switch your service. How can I help?',
      menu: ['Move appointment', 'Cancel appointment', 'Change service', 'Opening hours'],
      askRef: 'Sure. What is your reference (e.g. FF-4821) and the phone number you booked with?',
      found: 'I found your appointment:',
      apt: 'Your appointment', svc: 'Service', when: 'When', ref: 'Reference',
      pickTime: 'Which time suits you better? These are free:',
      moved: 'Appointment moved', movedMsg: 'Done! You will also get the confirmation by email.',
      askCancel: 'Are you sure you want to cancel this appointment?', yes: 'Yes, cancel', no: 'No, keep it',
      cancelled: 'Appointment cancelled', cancelledMsg: 'Your appointment is cancelled. Hope to see you soon!',
      kept: 'No problem, your appointment stays as it is.',
      pickSvc: 'Which service would you like instead?',
      changed: 'Service changed', changedMsg: 'Updated! The time stays the same.',
      hours: 'We are open:\nMon–Thu 11:00–21:00\nFri 11:00–20:00\nSat 10:00–14:00\nSun closed',
      prices: 'Haircut (incl. beard) € 25.00\nContour € 12.50\nBeard trim € 12.50\nKids haircut € 20.00\n\nOnline you pay a € 1.50 booking fee, the rest in the shop.',
      human: 'I am Fresh, a virtual assistant and not a person. Want to talk to the barber? Call 06 86 38 64 17.',
      late: 'Note: within 24 hours of your appointment I cannot change it. Please call the shop instead.',
      fallback: 'I did not quite get that yet. Pick one of these:',
      more: 'Anything else I can help with?', thanks: 'You are welcome! Have a great day.',
      newTime: 'New', old: 'Was'
    }
  };

  function lang() { return document.documentElement.lang === 'en' ? 'en' : 'nl'; }
  function t(k) { return TXT[lang()][k]; }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  // Random opening-hours slot a few days from now.
  function randomSlot(minDays) {
    var d = new Date();
    d.setDate(d.getDate() + minDays + Math.floor(Math.random() * 4));
    while (!HOURS[d.getDay()]) d.setDate(d.getDate() + 1);
    var h = HOURS[d.getDay()];
    d.setHours(h[0] + Math.floor(Math.random() * (h[1] - h[0] + 1)), 0, 0, 0);
    return d;
  }
  function fmt(d) {
    var l = lang() === 'en' ? 'en-GB' : 'nl-NL';
    return d.toLocaleDateString(l, { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' +
      String(d.getHours()).padStart(2, '0') + ':00';
  }

  var booking = null;
  var flow = null; // what the next free-text message answers

  function fakeBooking() {
    booking = { ref: 'FF-' + (1000 + Math.floor(Math.random() * 9000)), svc: pick(SERVICES), when: randomSlot(3) };
  }

  // ---------- DOM ----------
  var ICON_CHAT = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.6A8.5 8.5 0 1 1 21 12z"/></svg>';
  var ICON_X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_SEND = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 3.8 21.5 12 3 20.2l1.9-6.9L14 12 4.9 10.7z"/></svg>';
  var ICON_OK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zm-1.3 13.6-3.6-3.6 1.4-1.4 2.2 2.2 4.5-4.5 1.4 1.4z"/></svg>';

  var root = document.createElement('div');
  root.className = 'cd-root';
  root.innerHTML =
    '<button type="button" class="cd-launch" aria-expanded="false" aria-controls="cd-panel">' + ICON_CHAT +
      '<span class="cd-dot" aria-hidden="true"></span><span class="cd-label"></span></button>' +
    '<section class="cd-panel" id="cd-panel" role="dialog" aria-labelledby="cd-title" aria-hidden="true">' +
      '<header class="cd-head"><span class="cd-avatar"><img src="./images/ff-logo-white.svg" alt="" width="24" height="18"></span>' +
        '<div class="cd-title"><b id="cd-title"></b><span class="cd-status"></span></div>' +
        '<button type="button" class="cd-close">' + ICON_X + '</button></header>' +
      '<p class="cd-note"></p>' +
      '<div class="cd-log" aria-live="polite"></div>' +
      '<form class="cd-form" autocomplete="off"><input type="text" maxlength="300" enterkeyhint="send">' +
        '<button type="submit">' + ICON_SEND + '</button></form>' +
    '</section>';
  document.body.appendChild(root);

  var launch = root.querySelector('.cd-launch');
  var panel = root.querySelector('.cd-panel');
  var log = root.querySelector('.cd-log');
  var form = root.querySelector('.cd-form');
  var input = form.querySelector('input');
  var sendBtn = form.querySelector('button');
  var started = false;
  var busy = false;

  function applyLang() {
    launch.querySelector('.cd-label').textContent = t('launch');
    launch.setAttribute('aria-label', t('open'));
    root.querySelector('#cd-title').textContent = t('title');
    root.querySelector('.cd-status').textContent = t('status');
    root.querySelector('.cd-note').innerHTML = t('note');
    root.querySelector('.cd-close').setAttribute('aria-label', t('close'));
    input.placeholder = t('placeholder');
    input.setAttribute('aria-label', t('placeholder'));
    sendBtn.setAttribute('aria-label', t('send'));
  }
  applyLang();
  new MutationObserver(applyLang).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  function scroll() { log.scrollTop = log.scrollHeight; }

  function bubble(text, who) {
    var el = document.createElement('div');
    el.className = 'cd-msg cd-' + who;
    el.textContent = text;
    log.appendChild(el);
    scroll();
  }

  function card(tag, kind, rows) {
    var el = document.createElement('div');
    el.className = 'cd-card';
    var h = document.createElement('div');
    h.className = 'cd-tag' + (kind ? ' ' + kind : '');
    h.innerHTML = kind === 'ok' ? ICON_OK : '';
    h.appendChild(document.createTextNode(tag));
    el.appendChild(h);
    rows.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'cd-row';
      var k = document.createElement('span'); k.textContent = r[0];
      var v = document.createElement('b'); v.textContent = r[1];
      if (r[2]) { var s = document.createElement('s'); s.textContent = r[2]; v.appendChild(document.createElement('br')); v.appendChild(s); }
      row.appendChild(k); row.appendChild(v);
      el.appendChild(row);
    });
    log.appendChild(el);
    scroll();
  }

  function chips(list) {
    var wrap = document.createElement('div');
    wrap.className = 'cd-chips';
    list.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cd-chip';
      b.textContent = c.label;
      b.addEventListener('click', function () {
        if (busy) return;
        wrap.classList.add('used');
        bubble(c.label, 'user');
        c.run();
      });
      wrap.appendChild(b);
    });
    log.appendChild(wrap);
    scroll();
  }

  function retireChips() {
    log.querySelectorAll('.cd-chips:not(.used)').forEach(function (c) { c.classList.add('used'); });
  }

  // Bot "types" for a moment, then runs the steps.
  function bot(steps) {
    busy = true;
    sendBtn.disabled = true;
    var dots = document.createElement('div');
    dots.className = 'cd-typing';
    dots.innerHTML = '<i></i><i></i><i></i>';
    log.appendChild(dots);
    scroll();
    setTimeout(function () {
      dots.remove();
      steps();
      busy = false;
      sendBtn.disabled = false;
    }, 650 + Math.random() * 500);
  }

  function menu() {
    var m = t('menu');
    chips([
      { label: m[0], run: function () { start('move'); } },
      { label: m[1], run: function () { start('cancel'); } },
      { label: m[2], run: function () { start('service'); } },
      { label: m[3], run: function () { bot(function () { bubble(t('hours'), 'bot'); anythingElse(); }); } }
    ]);
  }

  function anythingElse() {
    flow = null;
    setTimeout(function () { bubble(t('more'), 'bot'); menu(); }, 500);
  }

  function start(kind) {
    flow = { step: 'ref', kind: kind };
    bot(function () { bubble(t('askRef'), 'bot'); });
  }

  function showBooking() {
    card(t('apt'), '', [[t('ref'), booking.ref], [t('svc'), booking.svc], [t('when'), fmt(booking.when)]]);
  }

  function afterLookup() {
    fakeBooking();
    var kind = flow.kind;
    bot(function () {
      bubble(t('found'), 'bot');
      showBooking();
      if (Math.random() < 0.15) { bubble(t('late'), 'bot'); anythingElse(); return; }

      if (kind === 'move') {
        bubble(t('pickTime'), 'bot');
        var seen = {};
        var opts = [];
        while (opts.length < 3) {
          var s = randomSlot(2);
          if (!seen[s.getTime()] && s.getTime() !== booking.when.getTime()) { seen[s.getTime()] = 1; opts.push(s); }
        }
        opts.sort(function (a, b) { return a - b; });
        chips(opts.map(function (d) {
          return { label: fmt(d), run: function () {
            var was = booking.when;
            booking.when = d;
            bot(function () {
              card(t('moved'), 'ok', [[t('ref'), booking.ref], [t('svc'), booking.svc], [t('newTime'), fmt(d), t('old') + ': ' + fmt(was)]]);
              bubble(t('movedMsg'), 'bot');
              anythingElse();
            });
          } };
        }));
      } else if (kind === 'cancel') {
        bubble(t('askCancel'), 'bot');
        chips([
          { label: t('yes'), run: function () { bot(function () {
            card(t('cancelled'), 'no', [[t('ref'), booking.ref], [t('svc'), booking.svc], [t('when'), fmt(booking.when)]]);
            bubble(t('cancelledMsg'), 'bot');
            anythingElse();
          }); } },
          { label: t('no'), run: function () { bot(function () { bubble(t('kept'), 'bot'); anythingElse(); }); } }
        ]);
      } else {
        bubble(t('pickSvc'), 'bot');
        chips(SERVICES.filter(function (s) { return s !== booking.svc; }).map(function (s) {
          return { label: s, run: function () {
            var was = booking.svc;
            booking.svc = s;
            bot(function () {
              card(t('changed'), 'ok', [[t('ref'), booking.ref], [t('svc'), s, t('old') + ': ' + was], [t('when'), fmt(booking.when)]]);
              bubble(t('changedMsg'), 'bot');
              anythingElse();
            });
          } };
        }));
      }
    });
    flow = null;
  }

  // Free text: answer the open question, or guess the intent from keywords.
  function handle(text) {
    if (flow && flow.step === 'ref') { afterLookup(); return; }
    var q = text.toLowerCase();
    if (/verplaats|verzet|ander(e)? (tijd|dag)|move|reschedul/.test(q)) return start('move');
    if (/annul|afzeg|cancel/.test(q)) return start('cancel');
    if (/behandel|service|dienst|wijzig|switch|change/.test(q)) return start('service');
    if (/open|tijden|hours|wanneer|when/.test(q)) return bot(function () { bubble(t('hours'), 'bot'); anythingElse(); });
    if (/prijs|prijzen|kost|price|cost|€/.test(q)) return bot(function () { bubble(t('prices'), 'bot'); anythingElse(); });
    if (/mens|human|person|echt|real|bot\b/.test(q)) return bot(function () { bubble(t('human'), 'bot'); anythingElse(); });
    if (/bedankt|dank|thanks|thank/.test(q)) return bot(function () { bubble(t('thanks'), 'bot'); });
    bot(function () { bubble(t('fallback'), 'bot'); menu(); });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;
    retireChips();
    bubble(text, 'user');
    input.value = '';
    handle(text);
  });

  function open() {
    document.documentElement.classList.add('cd-open');
    launch.setAttribute('aria-expanded', 'true');
    panel.setAttribute('aria-hidden', 'false');
    if (!started) {
      started = true;
      bot(function () { bubble(t('welcome'), 'bot'); menu(); });
    }
    setTimeout(function () { input.focus({ preventScroll: true }); }, 200);
  }
  function close() {
    document.documentElement.classList.remove('cd-open');
    launch.setAttribute('aria-expanded', 'false');
    panel.setAttribute('aria-hidden', 'true');
    launch.focus({ preventScroll: true });
  }

  launch.addEventListener('click', open);
  root.querySelector('.cd-close').addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.documentElement.classList.contains('cd-open') && panel.contains(document.activeElement)) close();
  });
})();
