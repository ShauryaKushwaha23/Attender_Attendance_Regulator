/* ==========================================================
   Attender - app.js  (no frameworks, no build step)

   DATA MODEL (saved per account in localStorage as "rc.data.<email>")
   S = { min: 75, od: true, sort: "added", subs: [ SUBJECT, ... ] }
   SUBJECT = { n: name, a: attended before tracking, t: held before tracking,
               rem: classes left, days: [0-6 weekdays], k: creation order,
               log: [ { d: "YYYY-MM-DD", s: "p"|"a"|"o"|"c" } ] }
     p = present, a = absent, o = on duty, c = cancelled (not counted)

   FILE MAP
   1. Accounts      - register / sign in (PBKDF2 password hashing)
   2. Maths         - exact integer attendance calculations
   3. Views         - subjects, today list, calendar, weekly trend
   4. Insights      - radar, subject bars, weekday, monthly, status mix
   5. Forms/Settings- add/edit subject, theme, backup, demo, delete account
   6. Boot          - restore session
   ========================================================== */
(function () {
  var BRAND = "Attender"; // change this to your own product name
  var $ = function (i) {
    return document.getElementById(i);
  };
  var DN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    LB = { p: "Present", a: "Absent", o: "On duty", c: "Cancelled" };
  function ls(k, d) {
    try {
      var v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch (e) {
      return d;
    }
  }
  function ss(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  }
  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  var tt;
  function toast(m, undo) {
    var t = $("toast");
    t.textContent = m;
    if (undo) {
      var b = document.createElement("button");
      b.textContent = "Undo";
      b.onclick = function () {
        undo();
        t.classList.remove("on");
      };
      t.appendChild(b);
    }
    t.classList.add("on");
    clearTimeout(tt);
    tt = setTimeout(
      function () {
        t.classList.remove("on");
      },
      undo ? 4500 : 1800,
    );
  }
  document.title = BRAND;
  document.querySelectorAll(".bn").forEach(function (e) {
    e.textContent = BRAND;
  });
  /* ---------- accounts (stored on this device) ---------- */
  var users = ls("rc.users", {}),
    U = null,
    S = null,
    mode = "in";
  function hash(pw, salt) {
    var e = new TextEncoder();
    return crypto.subtle
      .importKey("raw", e.encode(pw), "PBKDF2", false, ["deriveBits"])
      .then(function (k) {
        return crypto.subtle.deriveBits(
          { name: "PBKDF2", salt: e.encode(salt), iterations: 100000, hash: "SHA-256" },
          k,
          256,
        );
      })
      .then(function (b) {
        return Array.prototype.map
          .call(new Uint8Array(b), function (x) {
            return pad(x.toString(16));
          })
          .join("");
      });
  }
  function setMode(m) {
    mode = m;
    $("tin").setAttribute("aria-selected", m === "in");
    $("tup").setAttribute("aria-selected", m === "up");
    $("nl").hidden = m === "in";
    $("at").textContent = m === "in" ? "Welcome back" : "Create your account";
    $("go").textContent = m === "in" ? "Sign in" : "Create account";
    $("pw").autocomplete = m === "in" ? "current-password" : "new-password";
    $("err").textContent = "";
  }
  $("tin").onclick = function () {
    setMode("in");
  };
  $("tup").onclick = function () {
    setMode("up");
  };
  $("af").onsubmit = function (ev) {
    ev.preventDefault();
    var em = $("em").value.trim().toLowerCase(),
      pw = $("pw").value,
      nm = $("nm").value.trim(),
      er = $("err");
    er.textContent = "";
    if (!/^\S+@\S+\.\S+$/.test(em)) {
      er.textContent = "Enter a valid email address.";
      return;
    }
    if (mode === "up") {
      if (!nm) {
        er.textContent = "Enter your name.";
        return;
      }
      if (pw.length < 8) {
        er.textContent = "Use a password of at least 8 characters.";
        return;
      }
      if (users[em]) {
        er.textContent = "That email already has an account. Sign in instead.";
        return;
      }
      var salt = Array.prototype.map
        .call(crypto.getRandomValues(new Uint8Array(16)), function (x) {
          return pad(x.toString(16));
        })
        .join("");
      hash(pw, salt)
        .then(function (h) {
          users[em] = { name: nm, salt: salt, hash: h };
          ss("rc.users", users);
          enter(em);
        })
        .catch(function () {
          er.textContent = "Couldn’t create the account in this browser.";
        });
    } else {
      if (!users[em]) {
        er.textContent = "No account found for that email. Create one first.";
        return;
      }
      hash(pw, users[em].salt)
        .then(function (h) {
          if (h === users[em].hash) enter(em);
          else er.textContent = "Incorrect password.";
        })
        .catch(function () {
          er.textContent = "Couldn’t sign in in this browser.";
        });
    }
  };
  function enter(em) {
    U = em;
    ss("rc.session", em);
    S = ls("rc.data." + em, null);
    if (!S || !Array.isArray(S.subs)) S = { min: 75, od: true, subs: [] };
    $("pw").value = "";
    $("auth").hidden = true;
    $("app").hidden = false;
    $("uname").textContent = users[em].name;
    $("min").value = S.min;
    $("od").checked = S.od;
    $("sort").value = S.sort || "added";
    $("date").value = today();
    dayNote();
    go("home");
    render();
  }
  function leave() {
    U = null;
    S = null;
    ss("rc.session", null);
    $("app").hidden = true;
    $("auth").hidden = false;
    setMode("in");
  }
  $("out").onclick = $("out2").onclick = leave;
  function save() {
    if (U) ss("rc.data." + U, S);
  }
  /* ---------- maths (integers, so exact) ---------- */
  function stats(s) {
    var a = s.a,
      t = s.t,
      od = 0;
    s.log.forEach(function (x) {
      if (x.s === "c") return;
      t++;
      if (x.s === "p") a++;
      else if (x.s === "o") {
        od++;
        if (S.od) a++;
      }
    });
    return { a: a, t: t, od: od };
  }
  function pct(a, t) {
    return t ? Math.floor((a * 1000) / t) / 10 : 0;
  }
  function col(a, t) {
    if (!t) return "";
    var p = a * 100;
    return p >= (S.min + 5) * t ? "g" : p >= S.min * t ? "y" : "r";
  }
  function cd(n, d) {
    return Math.floor((n + d - 1) / d);
  }
  function advice(a, t, T) {
    if (T >= 100 || T < 1) return "";
    if (!t) return "Mark a class to see advice.";
    if (a * 100 >= T * t) {
      var m = Math.floor((100 * a - T * t) / T);
      return m > 0
        ? "You can miss " +
            m +
            " more " +
            (m === 1 ? "class" : "classes") +
            " and stay at or above " +
            T +
            "%."
        : "No spare classes. Missing the next one drops you below " + T + "%.";
    }
    var x = cd(T * t - 100 * a, 100 - T);
    return (
      "Attend the next " +
      x +
      " " +
      (x === 1 ? "class" : "classes") +
      " in a row to reach " +
      T +
      "%."
    );
  }
  function plan(a, t, R, T) {
    if (!R || R < 1) return "";
    var need = Math.max(0, cd(T * (t + R) - 100 * a, 100));
    if (need > R)
      return (
        "Even attending all " +
        R +
        " remaining classes ends at " +
        pct(a + R, t + R) +
        "%, short of " +
        T +
        "%."
      );
    return (
      "Of the " +
      R +
      " classes left, attend at least " +
      need +
      " to finish at " +
      T +
      "% or more. You can skip " +
      (R - need) +
      "."
    );
  }
  /* ---------- views ---------- */
  var TT = {
    home: "Subjects",
    cal: "Calendar",
    tt: "Timetable",
    ins: "Insights",
    calc: "Calculator",
    set: "Settings",
  };
  function go(v) {
    document.querySelectorAll(".nav").forEach(function (b) {
      if (b.dataset.v === v) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
    ["home", "tt", "cal", "ins", "calc", "set"].forEach(function (x) {
      $("v-" + x).hidden = x !== v;
    });
    $("vt").textContent = TT[v];
    $("dl").hidden = v !== "home";
    window.scrollTo(0, 0);
  }
  document.querySelectorAll(".nav").forEach(function (b) {
    b.onclick = function () {
      go(b.dataset.v);
    };
  });
  var CH = { g: "Safe", y: "Borderline", r: "At risk", "": "No data" };
  function render() {
    S.subs.forEach(function (s) {
      if (!s.id) s.id = uid();
    });
    if (!Array.isArray(S.tt)) S.tt = [];
    S.subs.forEach(function (s, i) {
      if (s.k == null) s.k = i;
    });
    if (editing < 0) {
      var sk =
        S.sort === "low"
          ? function (x) {
              var q = stats(x);
              return q.t ? q.a / q.t : 2;
            }
          : function (x) {
              return x.k;
            };
      S.subs.sort(function (x, y) {
        return sk(x) - sk(y);
      });
    }
    var L = $("list");
    L.innerHTML = "";
    var A = 0,
      H = 0,
      risk = 0;
    if (!S.subs.length) {
      var em = document.createElement("div");
      em.className = "panel empty";
      em.innerHTML =
        '<h3>Welcome. Let’s set up your first subject.</h3><ol class="steps"><li>Add a subject below, with its class days.</li><li>Tap Present, Absent or On duty after each class.</li><li>Watch the advice and charts update.</li></ol><button class="btn" id="tryDemo">Try it with demo data</button>';
      L.appendChild(em);
      em.querySelector("#tryDemo").onclick = function () {
        $("demo").click();
      };
    }
    S.subs.forEach(function (s, i) {
      var st = stats(s);
      A += st.a;
      H += st.t;
      var c = col(st.a, st.t),
        p = pct(st.a, st.t);
      if (c === "r") risk++;
      var d = document.createElement("div");
      d.className = "card " + c;
      var pl = plan(st.a, st.t, s.rem, S.min);
      if (editing === i) {
        d.className = "card";
        d.innerHTML =
          '<h3 style="margin:0">Edit subject</h3><div class="row"><label style="flex:2;min-width:150px">Name<input id="en"></label><label>Attended before tracking<input id="ea" type="number" inputmode="numeric" min="0"></label><label>Held before tracking<input id="et" type="number" inputmode="numeric" min="0"></label></div><div class="row" id="edc"></div><div class="row"><button class="btn" id="esv">Save changes</button><button class="q" id="ecn">Cancel</button></div>';
        d.querySelector("#en").value = s.n;
        d.querySelector("#ea").value = s.a;
        d.querySelector("#et").value = s.t;
        DN.forEach(function (n, w) {
          var l = document.createElement("label");
          l.className = "day";
          l.innerHTML =
            '<input type="checkbox" value="' +
            w +
            '"' +
            (s.days && s.days.indexOf(w) > -1 ? " checked" : "") +
            ">" +
            n;
          d.querySelector("#edc").appendChild(l);
        });
        d.querySelector("#esv").onclick = function () {
          var n = d.querySelector("#en").value.trim(),
            a = Math.max(0, parseInt(d.querySelector("#ea").value, 10) || 0),
            t = Math.max(0, parseInt(d.querySelector("#et").value, 10) || 0);
          if (!n) {
            toast("Enter a subject name");
            return;
          }
          if (a > t) t = a;
          s.n = n;
          s.a = a;
          s.t = t;
          s.days = Array.prototype.map.call(d.querySelectorAll("#edc input:checked"), function (x) {
            return +x.value;
          });
          editing = -1;
          save();
          render();
          toast("Subject updated");
        };
        d.querySelector("#ecn").onclick = function () {
          editing = -1;
          render();
        };
        L.appendChild(d);
        return;
      }
      d.innerHTML =
        '<div class="sh"><div><h2></h2><div class="meta">' +
        st.a +
        " of " +
        st.t +
        " attended" +
        (st.od ? " · " + st.od + " on duty" : "") +
        '</div></div><div class="pc ' +
        c +
        '">' +
        (st.t ? p.toFixed(1) + "%" : "–") +
        '<span class="chip">' +
        CH[c] +
        "</span></div></div>" +
        '<div class="bar"><i class="' +
        c +
        '" style="width:' +
        Math.min(p, 100) +
        '%"></i><u style="left:' +
        S.min +
        '%"></u></div>' +
        '<div class="msg ' +
        c +
        '">' +
        advice(st.a, st.t, S.min) +
        "</div>" +
        (pl ? '<div class="plan">' + pl + "</div>" : "") +
        '<div class="row mk"><button class="p" data-k="p">Present</button><button class="a" data-k="a">Absent</button><button class="o" data-k="o">On duty</button><button class="c" data-k="c">Cancelled</button></div>' +
        "<details" +
        (openD[s.k] ? " open" : "") +
        '><summary>History &amp; options</summary><div class="dots" aria-label="Recent classes, tap one to remove it"></div>' +
        '<div class="row"><label style="max-width:150px">Classes left<input data-k="r" type="number" inputmode="numeric" min="0" value="' +
        (s.rem || 0) +
        '"></label><button class="q" data-k="u">Undo last</button><button class="q" data-k="e">Edit</button><button class="q" data-k="d">Delete</button></div></details>';
      d.querySelector("h2").textContent = s.n;
      d.querySelector("details").ontoggle = function () {
        openD[s.k] = this.open;
      };
      var dots = d.querySelector(".dots");
      s.log.slice(-12).forEach(function (x, j, arr) {
        var idx = s.log.length - arr.length + j,
          b = document.createElement("button");
        b.className = x.s;
        b.textContent = x.s === "o" ? "D" : x.s.toUpperCase();
        b.title = x.d + " · tap to remove";
        b.setAttribute("aria-label", x.d + " " + LB[x.s] + ", remove");
        b.onclick = function () {
          s.log.splice(idx, 1);
          save();
          render();
        };
        dots.appendChild(b);
      });
      d.querySelectorAll("button[data-k]").forEach(function (b) {
        b.onclick = function () {
          var k = b.dataset.k;
          if (k === "p" || k === "a" || k === "o" || k === "c") {
            var en = { d: $("date").value || today(), s: k };
            s.log.push(en);
            toast(s.n + ": marked " + LB[k].toLowerCase(), function () {
              var q = s.log.indexOf(en);
              if (q > -1) {
                s.log.splice(q, 1);
                save();
                render();
              }
            });
          } else if (k === "u") s.log.pop();
          else if (k === "e") editing = i;
          else if (k === "d" && confirm("Delete " + s.n + " and its history?"))
            ((S.tt = S.tt.filter(function (t) {
              return t.sub !== s.id;
            })),
              S.subs.splice(i, 1));
          save();
          render();
        };
      });
      d.querySelector('input[data-k="r"]').onchange = function (e) {
        s.rem = Math.max(0, parseInt(e.target.value, 10) || 0);
        save();
        render();
      };
      L.appendChild(d);
    });
    var P = pct(A, H),
      c = col(A, H);
    var al = S.subs.filter(function (s) {
      var q = stats(s);
      return col(q.a, q.t) === "r";
    });
    $("alertp").hidden = !al.length;
    var ab = $("alertl");
    ab.innerHTML = "";
    al.forEach(function (s) {
      var q = stats(s),
        r = document.createElement("div"),
        b = document.createElement("b"),
        sp = document.createElement("span");
      r.className = "trow";
      b.textContent = s.n;
      sp.style.fontWeight = "400";
      sp.textContent = advice(q.a, q.t, S.min);
      r.appendChild(b);
      r.appendChild(sp);
      ab.appendChild(r);
    });
    var fl = [];
    S.subs.forEach(function (s) {
      s.log.forEach(function (x) {
        if (x.s !== "c") fl.push(x);
      });
    });
    fl.sort(function (x, y) {
      return x.d < y.d ? -1 : x.d > y.d ? 1 : 0;
    });
    var run = 0;
    for (var q = fl.length - 1; q >= 0 && fl[q].s !== "a"; q--) run++;
    $("sStr").textContent = run;
    $("sAll").textContent = H ? P.toFixed(1) + "%" : "–";
    document.querySelector(".stat.big").style.setProperty("--pct", H ? Math.min(P, 100) : 0);
    $("sAtt").textContent = A;
    $("sRisk").textContent = risk;
    $("sMsg").textContent = H
      ? "Overall attendance · " + (c === "r" ? "below" : "at or above") + " " + S.min + "% minimum"
      : "Overall attendance";
    calc();
    renderToday();
    renderCal();
    renderTrend();
    renderIns();
    renderNow();
    renderTT();
  }
  function shift(n) {
    var d = new Date(($("date").value || today()) + "T00:00:00");
    d.setDate(d.getDate() + n);
    $("date").value = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    renderToday();
    dayNote();
  }
  function dayNote() {
    var d = new Date(($("date").value || today()) + "T00:00:00"),
      n = Math.round((d - new Date(today() + "T00:00:00")) / 864e5);
    $("dnote").textContent =
      n === 0 ? "Today" : n === -1 ? "Yesterday" : n === 1 ? "Tomorrow" : DN[d.getDay()];
  }

  /* ---------- Timetable, current time and day-wise marking ---------- */
  var FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var ORD = [1, 2, 3, 4, 5, 6, 0];
  function uid() {
    return Math.random().toString(36).slice(2, 9);
  }
  function mins(t) {
    var p = t.split(":");
    return +p[0] * 60 + +p[1];
  }
  function nowMin() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
  function hm(m) {
    var h = Math.floor(m / 60),
      r = m % 60;
    return h ? h + "h" + (r ? " " + r + "m" : "") : r + "m";
  }
  function byStart(a, b) {
    return a.st < b.st ? -1 : a.st > b.st ? 1 : 0;
  }
  function subById(id) {
    return S.subs.filter(function (s) {
      return s.id === id;
    })[0];
  }
  function entryFor(s, sl, ds) {
    return s.log.filter(function (e) {
      return e.d === ds && e.t === sl.id;
    })[0];
  }
  function dayItems(ds) {
    var w = new Date(ds + "T00:00:00").getDay(),
      it = [];
    S.tt
      .filter(function (t) {
        return t.day === w;
      })
      .sort(byStart)
      .forEach(function (t) {
        var s = subById(t.sub);
        if (s) it.push({ sb: s, sl: t });
      });
    S.subs.forEach(function (s) {
      if (
        s.days &&
        s.days.indexOf(w) > -1 &&
        !S.tt.some(function (t) {
          return t.sub === s.id;
        })
      )
        it.push({ sb: s, sl: null });
    });
    return it;
  }
  function markSlot(s, sl, ds, k) {
    var ex = entryFor(s, sl, ds),
      prev = ex ? ex.s : null,
      en = ex;
    if (ex) ex.s = k;
    else {
      en = { d: ds, s: k, t: sl.id };
      s.log.push(en);
    }
    save();
    render();
    toast(s.n + ": " + LB[k], function () {
      if (prev) en.s = prev;
      else {
        var q = s.log.indexOf(en);
        if (q > -1) s.log.splice(q, 1);
      }
      save();
      render();
    });
  }
  function renderToday() {
    var ds = $("date").value || today(),
      w = new Date(ds + "T00:00:00").getDay(),
      box = $("todaylist");
    box.innerHTML = "";
    var it = dayItems(ds),
      nm = nowMin(),
      isToday = ds === today();
    $("todayp").hidden = !it.length;
    $("todayh").textContent = (isToday ? "Today" : ds) + " · " + FULL[w];
    it.forEach(function (x) {
      var s = x.sb,
        sl = x.sl,
        r = document.createElement("div");
      r.className = "trow";
      var ent = sl ? entryFor(s, sl, ds) : null;
      var m = sl
        ? ent
          ? [LB[ent.s]]
          : []
        : s.log
            .filter(function (e) {
              return e.d === ds;
            })
            .map(function (e) {
              return LB[e.s];
            });
      var tm = document.createElement("span");
      tm.className = "tm";
      tm.textContent = sl ? sl.st + "–" + sl.en : "Any time";
      var n = document.createElement("span");
      n.className = "nm";
      n.textContent = s.n + (m.length ? " · " + m.join(", ") : "");
      if (sl && isToday) {
        var cur = nm >= mins(sl.st) && nm < mins(sl.en),
          past = nm >= mins(sl.en);
        var tag = function (t, c) {
          var e = document.createElement("em");
          e.className = "tag " + c;
          e.textContent = t;
          n.appendChild(e);
        };
        if (cur) {
          r.classList.add("now");
          tag("Now", "");
        } else if (past && !ent) tag("Unmarked", "warn");
      }
      r.appendChild(tm);
      r.appendChild(n);
      ["p", "a", "o", "c"].forEach(function (k) {
        var b = document.createElement("button");
        b.className = k;
        b.textContent = k === "o" ? "D" : k.toUpperCase();
        b.setAttribute("aria-label", "Mark " + s.n + " " + LB[k]);
        b.onclick = function () {
          if (sl) markSlot(s, sl, ds, k);
          else {
            var en = { d: ds, s: k };
            s.log.push(en);
            save();
            render();
            toast(s.n + ": " + LB[k], function () {
              var q = s.log.indexOf(en);
              if (q > -1) {
                s.log.splice(q, 1);
                save();
                render();
              }
            });
          }
        };
        r.appendChild(b);
      });
      box.appendChild(r);
    });
  }
  function renderNow() {
    var b = $("nowbar");
    if (!S) return;
    var ds = today(),
      nm = nowMin(),
      it = dayItems(ds).filter(function (x) {
        return x.sl;
      }),
      cur = null,
      nxt = null;
    it.forEach(function (x) {
      var a = mins(x.sl.st),
        e = mins(x.sl.en);
      if (nm >= a && nm < e) cur = x;
      else if (nm < a && !nxt) nxt = x;
    });
    b.innerHTML = "";
    b.hidden = !it.length;
    if (!it.length) return;
    var t = document.createElement("div");
    t.className = "grow";
    b.appendChild(t);
    if (cur) {
      t.innerHTML =
        "<b>Now:</b> " +
        esc(cur.sb.n) +
        " · ends " +
        cur.sl.en +
        " (" +
        hm(mins(cur.sl.en) - nm) +
        " left)" +
        (nxt
          ? '<br><span class="meta">Next: ' + esc(nxt.sb.n) + " at " + nxt.sl.st + "</span>"
          : "");
      if (!entryFor(cur.sb, cur.sl, ds)) {
        var btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = "Mark present";
        btn.onclick = function () {
          markSlot(cur.sb, cur.sl, ds, "p");
        };
        b.appendChild(btn);
      }
    } else if (nxt)
      t.innerHTML =
        "<b>Next:</b> " +
        esc(nxt.sb.n) +
        " at " +
        nxt.sl.st +
        " (in " +
        hm(mins(nxt.sl.st) - nm) +
        ")";
    else t.innerHTML = "<b>No more classes today.</b>";
  }
  function renderTT() {
    var sel = $("tsub"),
      keep = sel.value;
    sel.innerHTML = "";
    S.subs.forEach(function (s) {
      var o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.n;
      sel.appendChild(o);
    });
    if (keep) sel.value = keep;
    var g = $("ttgrid"),
      an = $("ttan");
    g.innerHTML = "";
    if (!S.tt.length) {
      g.innerHTML = '<p class="meta">No slots yet. Add your first class above.</p>';
      an.innerHTML = '<p class="meta">Add some slots to see the analysis.</p>';
      return;
    }
    ORD.forEach(function (d) {
      var l = S.tt
        .filter(function (t) {
          return t.day === d;
        })
        .sort(byStart);
      if (!l.length) return;
      var h = document.createElement("div");
      h.className = "ttday";
      h.textContent = FULL[d];
      g.appendChild(h);
      l.forEach(function (t) {
        var s = subById(t.sub),
          r = document.createElement("div");
        r.className = "ttrow";
        var a = document.createElement("span");
        a.className = "tm";
        a.textContent = t.st + "–" + t.en;
        var n = document.createElement("span");
        n.className = "nm";
        n.textContent = s ? s.n : "(deleted subject)";
        var x = document.createElement("button");
        x.className = "q";
        x.textContent = "Remove";
        x.onclick = function () {
          S.tt = S.tt.filter(function (q) {
            return q.id !== t.id;
          });
          save();
          render();
        };
        r.appendChild(a);
        r.appendChild(n);
        r.appendChild(x);
        g.appendChild(r);
      });
    });
    var valid = S.tt.filter(function (t) {
        return subById(t.sub);
      }),
      days = {},
      mn = 0,
      per = {};
    var W = Math.max(1, Math.min(30, parseInt($("tweeks").value, 10) || 4));
    valid.forEach(function (t) {
      var d = mins(t.en) - mins(t.st);
      mn += d;
      per[t.sub] = (per[t.sub] || 0) + 1;
      var o = (days[t.day] = days[t.day] || { c: 0, m: 0, l: [] });
      o.c++;
      o.m += d;
      o.l.push(t);
    });
    var busy = null;
    ORD.forEach(function (d) {
      if (days[d] && (!busy || days[d].m > days[busy].m)) busy = d;
    });
    var free = [1, 2, 3, 4, 5]
      .filter(function (d) {
        return !days[d];
      })
      .map(function (d) {
        return DN[d];
      });
    var gap = null;
    ORD.forEach(function (d) {
      if (!days[d]) return;
      var l = days[d].l.sort(byStart);
      for (var i = 1; i < l.length; i++) {
        var gp = mins(l[i].st) - mins(l[i - 1].en);
        if (gp > 0 && (!gap || gp > gap.m)) gap = { m: gp, d: d, a: l[i - 1].en, b: l[i].st };
      }
    });
    var risk = S.subs.filter(function (s) {
      var q = stats(s);
      return per[s.id] && col(q.a, q.t) === "r";
    });
    var f =
      "<li>Weekly load: <b>" + valid.length + " classes</b>, " + hm(mn) + " of lectures.</li>";
    if (busy !== null)
      f +=
        "<li>Busiest day: <b>" +
        FULL[busy] +
        "</b> (" +
        days[busy].c +
        " classes, " +
        hm(days[busy].m) +
        ").</li>";
    f +=
      "<li>" +
      (free.length
        ? "Free weekdays: <b>" + free.join(", ") + "</b>."
        : "No free weekday in the week.") +
      "</li>";
    if (gap)
      f +=
        "<li>Longest break: <b>" +
        hm(gap.m) +
        "</b> on " +
        FULL[gap.d] +
        ", between " +
        gap.a +
        " and " +
        gap.b +
        ".</li>";
    if (risk.length)
      f +=
        "<li>Priority: <b>" +
        risk
          .map(function (s) {
            return esc(s.n);
          })
          .join(", ") +
        "</b> below " +
        S.min +
        "%. Attend every scheduled class for these.</li>";
    var rows = "";
    S.subs
      .filter(function (s) {
        return per[s.id];
      })
      .forEach(function (s) {
        var q = stats(s),
          n = per[s.id] * W,
          one = pct(q.a + n - W, q.t + n),
          all = pct(q.a + n, q.t + n);
        rows +=
          "<tr><td><b>" +
          esc(s.n) +
          "</b><small>" +
          plan(q.a, q.t, n, S.min) +
          "</small></td><td>" +
          per[s.id] +
          "</td><td>" +
          (q.t ? pct(q.a, q.t).toFixed(1) + "%" : "–") +
          '</td><td class="' +
          col(q.a + n, q.t + n) +
          '">' +
          all.toFixed(1) +
          '%</td><td class="' +
          col(q.a + n - W, q.t + n) +
          '">' +
          one.toFixed(1) +
          "%</td></tr>";
      });
    an.innerHTML =
      '<ul class="facts">' +
      f +
      '</ul><h3 style="margin-top:6px">Forecast for the next ' +
      W +
      (W === 1 ? " week" : " weeks") +
      '</h3><div class="scroll"><table class="tbl"><thead><tr><th>Subject</th><th>Per week</th><th>Now</th><th>Attend all</th><th>Miss 1 a week</th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div>" +
      '<p class="meta" style="margin:8px 0 0">Assumes every scheduled class takes place. The guidance under each subject uses your minimum of ' +
      S.min +
      "%.</p>";
  }
  function tick() {
    var d = new Date();
    $("clock").textContent =
      d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) +
      " · " +
      DN[d.getDay()] +
      " " +
      d.getDate() +
      " " +
      d.toLocaleString("en", { month: "short" });
  }
  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function agg(kf) {
    var m = {};
    S.subs.forEach(function (sb) {
      sb.log.forEach(function (x) {
        if (x.s === "c") return;
        var k = kf(x),
          o = (m[k] = m[k] || { a: 0, t: 0 });
        o.t++;
        if (x.s === "p" || (x.s === "o" && S.od)) o.a++;
      });
    });
    return m;
  }
  function bchart(it, label) {
    var n = it.length,
      w = Math.floor(332 / n),
      bw = w - 8,
      y0 = 86 - S.min * 0.7,
      h =
        '<svg viewBox="0 0 340 120" style="width:100%;height:auto" role="img" aria-label="' +
        label +
        '"><line x1="0" x2="340" y1="' +
        y0 +
        '" y2="' +
        y0 +
        '" stroke="var(--mute)" stroke-dasharray="4 4" opacity=".6"/>';
    it.forEach(function (d, j) {
      var x = j * w + 4,
        c = col(d.a, d.t),
        p = d.t ? Math.floor((d.a * 100) / d.t) : 0,
        bh = d.t ? Math.max(3, p * 0.7) : 0;
      h +=
        (d.t
          ? '<rect x="' +
            x +
            '" y="' +
            (86 - bh) +
            '" width="' +
            bw +
            '" height="' +
            bh +
            '" rx="4" style="fill:var(--' +
            c +
            ')"/><text x="' +
            (x + bw / 2) +
            '" y="' +
            (82 - bh) +
            '" text-anchor="middle" font-size="11" font-weight="700" style="fill:var(--ink)">' +
            p +
            "%</text>"
          : "") +
        '<text x="' +
        (x + bw / 2) +
        '" y="104" text-anchor="middle" font-size="11" style="fill:var(--mute)">' +
        esc(d.l) +
        "</text>";
    });
    return h + "</svg>";
  }
  function renderIns() {
    var rs = S.subs
        .map(function (s) {
          var x = stats(s);
          return { n: s.n, a: x.a, t: x.t, p: pct(x.a, x.t) };
        })
        .filter(function (r) {
          return r.t;
        }),
      none = '<p class="meta">Mark some classes to see this chart.</p>';
    function nm(s) {
      return s.length > 12 ? s.slice(0, 11) + "…" : s;
    }
    if (rs.length < 3)
      $("radar").innerHTML =
        '<p class="meta">Add attendance for at least 3 subjects to see the radar chart.</p>';
    else {
      var cx = 180,
        cy = 165,
        R = 105,
        n = rs.length;
      var pt = function (i, p) {
        var a = -Math.PI / 2 + (i * 2 * Math.PI) / n,
          r = (R * Math.min(p, 100)) / 100;
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      };
      var poly = function (f) {
        return rs
          .map(function (r, i) {
            return pt(i, f(r)).join(",");
          })
          .join(" ");
      };
      var h =
        '<svg viewBox="0 0 360 340" style="width:100%;max-width:460px;display:block;margin:auto;height:auto" role="img" aria-label="Radar chart of attendance by subject">';
      [25, 50, 75, 100].forEach(function (g) {
        h +=
          '<polygon points="' +
          poly(function () {
            return g;
          }) +
          '" fill="none" style="stroke:var(--line)"/>';
      });
      rs.forEach(function (r, i) {
        var e = pt(i, 100);
        h +=
          '<line x1="' +
          cx +
          '" y1="' +
          cy +
          '" x2="' +
          e[0] +
          '" y2="' +
          e[1] +
          '" style="stroke:var(--line)"/>';
      });
      h +=
        '<polygon points="' +
        poly(function () {
          return S.min;
        }) +
        '" fill="none" stroke-dasharray="5 4" stroke-width="1.5" style="stroke:var(--mute)"/>';
      h +=
        '<polygon points="' +
        poly(function (r) {
          return r.p;
        }) +
        '" style="fill:var(--pri);fill-opacity:.28;stroke:var(--pri)" stroke-width="2.5" stroke-linejoin="round"/>';
      rs.forEach(function (r, i) {
        var q = pt(i, r.p),
          a = -Math.PI / 2 + (i * 2 * Math.PI) / n,
          co = Math.cos(a),
          si = Math.sin(a),
          lx = cx + (R + 14) * co,
          ly = cy + (R + 14) * si + (si < -0.5 ? -12 : si > 0.5 ? 6 : -4),
          an = co > 0.3 ? "start" : co < -0.3 ? "end" : "middle";
        h +=
          '<circle cx="' +
          q[0] +
          '" cy="' +
          q[1] +
          '" r="5" style="fill:var(--' +
          col(r.a, r.t) +
          ');stroke:var(--card)" stroke-width="2"/><text x="' +
          lx +
          '" y="' +
          ly +
          '" text-anchor="' +
          an +
          '" font-size="12" style="fill:var(--ink)"><tspan x="' +
          lx +
          '">' +
          esc(nm(r.n)) +
          '</tspan><tspan x="' +
          lx +
          '" dy="14" font-weight="700" style="fill:var(--' +
          col(r.a, r.t) +
          ')">' +
          r.p.toFixed(0) +
          "%</tspan></text>";
      });
      $("radar").innerHTML = h + "</svg>";
    }
    if (!rs.length) $("sbars").innerHTML = none;
    else {
      var h2 =
        '<svg viewBox="0 0 340 ' +
        (rs.length * 38 + 6) +
        '" style="width:100%;height:auto" role="img" aria-label="Attendance by subject">';
      rs.forEach(function (r, i) {
        var y = i * 38,
          c = col(r.a, r.t);
        h2 +=
          '<text x="0" y="' +
          (y + 12) +
          '" font-size="13" font-weight="600" style="fill:var(--ink)">' +
          esc(nm(r.n)) +
          '</text><text x="340" y="' +
          (y + 12) +
          '" text-anchor="end" font-size="13" font-weight="700" style="fill:var(--' +
          c +
          ')">' +
          r.p.toFixed(1) +
          '%</text><rect x="0" y="' +
          (y + 19) +
          '" width="340" height="9" rx="4" style="fill:var(--line)"/><rect x="0" y="' +
          (y + 19) +
          '" width="' +
          Math.min(r.p, 100) * 3.4 +
          '" height="9" rx="4" style="fill:var(--' +
          c +
          ')"/><rect x="' +
          S.min * 3.4 +
          '" y="' +
          (y + 15) +
          '" width="2" height="17" style="fill:var(--ink);opacity:.55"/>';
      });
      $("sbars").innerHTML =
        h2 +
        '</svg><p class="meta" style="margin:6px 0 0">The dark tick on each bar is your minimum.</p>';
    }
    var wa = agg(function (x) {
        return new Date(x.d + "T00:00:00").getDay();
      }),
      any = Object.keys(wa).length;
    $("wd").innerHTML = any
      ? bchart(
          [1, 2, 3, 4, 5, 6, 0].map(function (d) {
            var o = wa[d] || { a: 0, t: 0 };
            return { l: DN[d], a: o.a, t: o.t };
          }),
          "Attendance by weekday",
        ) +
        '<p class="meta" style="margin:6px 0 0">Low bars show the weekdays you tend to miss.</p>'
      : none;
    var ma = agg(function (x) {
        return x.d.slice(0, 7);
      }),
      nw = new Date(),
      ms = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date(nw.getFullYear(), nw.getMonth() - i, 1),
        k = d.getFullYear() + "-" + pad(d.getMonth() + 1),
        o = ma[k] || { a: 0, t: 0 };
      ms.push({ l: d.toLocaleString("en", { month: "short" }), a: o.a, t: o.t });
    }
    $("mo").innerHTML = ms.some(function (m) {
      return m.t;
    })
      ? bchart(ms, "Attendance by month")
      : none;
    var cnt = { p: 0, a: 0, o: 0, c: 0 },
      tot = 0;
    S.subs.forEach(function (s) {
      s.log.forEach(function (x) {
        cnt[x.s]++;
        tot++;
      });
    });
    if (!tot) $("mix").innerHTML = none;
    else {
      var x0 = 0,
        hm =
          '<svg viewBox="0 0 340 26" style="width:100%;height:auto" role="img" aria-label="Share of present, absent, on duty and cancelled classes">',
        lg = '<div class="row" style="margin-top:10px;gap:14px">';
      ["p", "a", "o", "c"].forEach(function (k) {
        var w = (cnt[k] / tot) * 340,
          cc = k === "c" ? "mute" : k === "p" ? "g" : k === "a" ? "r" : "o";
        if (w)
          hm +=
            '<rect x="' +
            x0 +
            '" y="0" width="' +
            w +
            '" height="26" style="fill:var(--' +
            cc +
            ')"/>';
        x0 += w;
        lg +=
          '<span style="font-size:14px"><b style="color:var(--' +
          cc +
          ')">●</b> ' +
          LB[k] +
          " " +
          cnt[k] +
          " (" +
          Math.round((cnt[k] / tot) * 100) +
          "%)</span>";
      });
      $("mix").innerHTML = hm + "</svg>" + lg + "</div>";
    }
  }
  var editing = -1,
    openD = {};
  function renderTrend() {
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var mon = new Date(now);
    mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    var wk = [],
      i;
    for (i = 7; i >= 0; i--) {
      var d0 = new Date(mon);
      d0.setDate(mon.getDate() - 7 * i);
      wk.push({ s: d0, a: 0, t: 0 });
    }
    S.subs.forEach(function (sb) {
      sb.log.forEach(function (x) {
        if (x.s === "c") return;
        var k = Math.floor(Math.round((new Date(x.d + "T00:00:00") - wk[0].s) / 864e5) / 7);
        if (k < 0 || k > 7) return;
        wk[k].t++;
        if (x.s === "p" || (x.s === "o" && S.od)) wk[k].a++;
      });
    });
    var any = wk.some(function (w) {
      return w.t;
    });
    $("trendp").hidden = !any;
    if (!any) return;
    var y0 = 86 - S.min * 0.7,
      h =
        '<svg viewBox="0 0 340 120" style="width:100%;height:auto" role="img" aria-label="Weekly attendance percentage for the last 8 weeks"><line x1="0" x2="340" y1="' +
        y0 +
        '" y2="' +
        y0 +
        '" stroke="var(--mute)" stroke-dasharray="4 4" opacity=".6"/>';
    wk.forEach(function (w, j) {
      var x = j * 42 + 4,
        c = col(w.a, w.t),
        p = w.t ? Math.floor((w.a * 100) / w.t) : 0,
        bh = w.t ? Math.max(3, p * 0.7) : 0;
      h +=
        (w.t
          ? '<rect x="' +
            x +
            '" y="' +
            (86 - bh) +
            '" width="34" height="' +
            bh +
            '" rx="4" style="fill:var(--' +
            (c || "mute") +
            ')"/><text x="' +
            (x + 17) +
            '" y="' +
            (82 - bh) +
            '" text-anchor="middle" font-size="11" font-weight="700" style="fill:var(--ink)">' +
            p +
            "%</text>"
          : "") +
        '<text x="' +
        (x + 17) +
        '" y="104" text-anchor="middle" font-size="10" style="fill:var(--mute)">' +
        w.s.getDate() +
        "/" +
        (w.s.getMonth() + 1) +
        "</text>";
    });
    $("trend").innerHTML = h + "</svg>";
  }
  var cm = new Date(),
    sel = null;
  cm.setDate(1);
  function renderCal() {
    var y = cm.getFullYear(),
      mo = cm.getMonth(),
      g = $("grid");
    g.innerHTML = "";
    $("mt").textContent = cm.toLocaleString("en", { month: "long", year: "numeric" });
    var map = {};
    S.subs.forEach(function (s) {
      s.log.forEach(function (x) {
        (map[x.d] = map[x.d] || []).push([s.n, x.s]);
      });
    });
    DN.forEach(function (n) {
      var h = document.createElement("div");
      h.className = "ch";
      h.textContent = n.slice(0, 2);
      g.appendChild(h);
    });
    for (var k = 0; k < new Date(y, mo, 1).getDay(); k++)
      g.appendChild(document.createElement("div"));
    for (var d = 1; d <= new Date(y, mo + 1, 0).getDate(); d++)
      (function (d) {
        var ds = y + "-" + pad(mo + 1) + "-" + pad(d),
          e = map[ds] || [],
          b = document.createElement("button");
        var st = e.some(function (z) {
          return z[1] === "a";
        })
          ? "a"
          : e.some(function (z) {
                return z[1] !== "c";
              })
            ? "p"
            : "";
        b.innerHTML = "<span>" + d + "</span>" + (st ? '<i class="' + st + '"></i>' : "<i></i>");
        if (ds === today()) b.className = "now";
        b.setAttribute("aria-pressed", sel === ds);
        b.onclick = function () {
          sel = ds;
          $("dayinfo").textContent = e.length
            ? ds +
              ": " +
              e
                .map(function (z) {
                  return z[0] + " " + LB[z[1]].toLowerCase();
                })
                .join("; ")
            : ds + ": nothing marked.";
          renderCal();
        };
        g.appendChild(b);
      })(d);
  }
  $("pm").onclick = function () {
    cm.setMonth(cm.getMonth() - 1);
    renderCal();
  };
  $("nx").onclick = function () {
    cm.setMonth(cm.getMonth() + 1);
    renderCal();
  };
  function calc() {
    var a = parseInt($("ca").value, 10),
      t = parseInt($("ct").value, 10),
      g = parseInt($("cg").value, 10),
      r = parseInt($("cr").value, 10) || 0;
    var bad = isNaN(a) || isNaN(t) || isNaN(g) || a < 0 || a > t || g < 1 || g > 99;
    $("cres").textContent = bad
      ? "Enter valid numbers. Attended can’t exceed held, and the target must be 1–99."
      : "Now at " + pct(a, t).toFixed(1) + "%. " + advice(a, t, g);
    var p = bad ? "" : plan(a, t, r, g);
    $("cplan").textContent = p;
    $("cplan").hidden = !p;
  }
  ["ca", "ct", "cg", "cr"].forEach(function (i) {
    $(i).oninput = calc;
  });
  /* ---------- forms ---------- */
  var dc = $("dchips");
  dc.innerHTML =
    '<span class="meta" style="width:100%">Class days (optional, adds it to the daily list)</span>';
  DN.forEach(function (n, i) {
    var l = document.createElement("label");
    l.className = "day";
    l.innerHTML = '<input type="checkbox" value="' + i + '">' + n;
    dc.appendChild(l);
  });
  $("date").onchange = function () {
    renderToday();
    dayNote();
  };
  $("dprev").onclick = function () {
    shift(-1);
  };
  $("dnext").onclick = function () {
    shift(1);
  };
  $("dtoday").onclick = function () {
    $("date").value = today();
    renderToday();
    dayNote();
  };
  $("add").onclick = function () {
    var n = $("n").value.trim(),
      a = Math.max(0, parseInt($("a").value, 10) || 0),
      t = Math.max(0, parseInt($("t").value, 10) || 0);
    if (!n) {
      $("n").focus();
      toast("Enter a subject name");
      return;
    }
    if (a > t) t = a;
    var dys = Array.prototype.map.call(
      document.querySelectorAll("#dchips input:checked"),
      function (x) {
        x.checked = false;
        return +x.value;
      },
    );
    S.subs.push({ n: n, a: a, t: t, rem: 0, days: dys, log: [] });
    $("n").value = "";
    $("a").value = 0;
    $("t").value = 0;
    save();
    render();
  };
  $("min").onchange = function () {
    var v = parseInt($("min").value, 10);
    if (v >= 1 && v <= 99) {
      S.min = v;
      save();
      render();
    } else $("min").value = S.min;
  };
  $("od").onchange = function () {
    S.od = $("od").checked;
    save();
    render();
  };
  $("reset").onclick = function () {
    if (confirm("Delete every subject and all history for this account?")) {
      S.subs = [];
      S.tt = [];
      save();
      render();
    }
  };
  function csv() {
    var r = ["Subject,Date,Status"];
    S.subs.forEach(function (s) {
      s.log.forEach(function (x) {
        r.push('"' + s.n.replace(/"/g, '""') + '",' + x.d + "," + LB[x.s]);
      });
    });
    return r.join("\n");
  }
  function show(t) {
    var io = $("io");
    io.value = t;
    io.focus();
    io.select();
    try {
      navigator.clipboard.writeText(t).then(
        function () {
          toast("Copied to clipboard");
        },
        function () {},
      );
    } catch (e) {}
  }
  $("bcsv").onclick = function () {
    show(csv());
  };
  $("bjson").onclick = function () {
    show(JSON.stringify(S));
  };
  $("brest").onclick = function () {
    try {
      var o = JSON.parse($("io").value);
      if (!o || !Array.isArray(o.subs)) throw 0;
      if (confirm("Replace current data with this backup?")) {
        S = {
          min: o.min || 75,
          od: o.od !== false,
          subs: o.subs,
          tt: Array.isArray(o.tt) ? o.tt : [],
        };
        save();
        $("min").value = S.min;
        $("od").checked = S.od;
        render();
        toast("Backup restored");
      }
    } catch (e) {
      toast("That isn’t a valid backup");
    }
  };
  /* ---------- boot ---------- */
  function applyTheme(t) {
    var r = document.documentElement;
    if (t === "auto") r.removeAttribute("data-theme");
    else r.setAttribute("data-theme", t);
  }
  var th = ls("rc.theme", "dark");
  applyTheme(th);
  $("theme").value = th;
  $("theme").onchange = function () {
    ss("rc.theme", this.value);
    applyTheme(this.value);
  };
  $("spw").onchange = function () {
    $("pw").type = this.checked ? "text" : "password";
  };
  $("n").onkeydown = function (e) {
    if (e.key === "Enter") $("add").click();
  };
  $("sort").onchange = function () {
    S.sort = this.value;
    save();
    render();
  };
  $("allp").onclick = function () {
    var ds = $("date").value || today(),
      n = 0;
    dayItems(ds).forEach(function (x) {
      var s = x.sb,
        sl = x.sl;
      var done = sl
        ? !!entryFor(s, sl, ds)
        : s.log.some(function (e) {
            return e.d === ds;
          });
      if (!done) {
        s.log.push(sl ? { d: ds, s: "p", t: sl.id } : { d: ds, s: "p" });
        n++;
      }
    });
    save();
    render();
    toast(n ? "Marked " + n + " present" : "Everything is already marked");
  };
  $("tadd").onclick = function () {
    var sid = $("tsub").value,
      day = +$("tday").value,
      st = $("tst").value,
      en = $("ten").value;
    if (!sid) {
      toast("Add a subject first");
      return;
    }
    if (!st || !en || mins(en) <= mins(st)) {
      toast("End time must be after start time");
      return;
    }
    var clash = S.tt.filter(function (t) {
      return t.day === day && mins(st) < mins(t.en) && mins(en) > mins(t.st);
    })[0];
    if (clash) {
      var cs = subById(clash.sub);
      toast("Overlaps " + (cs ? cs.n : "another class") + " " + clash.st + "–" + clash.en);
      return;
    }
    S.tt.push({ id: uid(), sub: sid, day: day, st: st, en: en });
    save();
    render();
    toast("Slot added");
  };
  $("tweeks").oninput = renderTT;
  tick();
  var lastMin = -1;
  setInterval(function () {
    tick();
    var m = nowMin();
    if (S && m !== lastMin) {
      lastMin = m;
      renderNow();
      if (($("date").value || today()) === today()) renderToday();
    }
  }, 1000);
  $("demo").onclick = function () {
    var seed = 7;
    function rnd() {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    }
    var D = [
        ["Demo: Mathematics", [1, 3, 5], 0.88],
        ["Demo: Python", [2, 4], 0.8],
        ["Demo: Networks", [1, 2, 4], 0.62],
        ["Demo: Statistics", [3, 5], 0.74],
      ],
      now = new Date();
    now.setHours(12, 0, 0, 0);
    D.forEach(function (x) {
      var lg = [];
      for (var i = 55; i >= 1; i--) {
        var t = new Date(now);
        t.setDate(now.getDate() - i);
        if (x[1].indexOf(t.getDay()) < 0) continue;
        var r = rnd();
        lg.push({
          d: t.getFullYear() + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate()),
          s: r < 0.04 ? "c" : r < 0.04 + x[2] * 0.96 ? "p" : "a",
        });
      }
      S.subs.push({ n: x[0], a: 0, t: 0, rem: 0, days: x[1], log: lg });
    });
    save();
    render();
    toast("Demo subjects added");
  };
  $("delacc").onclick = function () {
    if (confirm("Permanently delete this account and all its data?")) {
      var e = U;
      delete users[e];
      ss("rc.users", users);
      try {
        localStorage.removeItem("rc.data." + e);
      } catch (x) {}
      leave();
    }
  };
  var sess = ls("rc.session", null);
  if (sess && users[sess]) enter(sess);
  else {
    $("auth").hidden = false;
    setMode("in");
  }
})();
