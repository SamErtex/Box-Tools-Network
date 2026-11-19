/* IXC Dev Tools V3 original content script.
 * OPA integration: execution is gated by opaDevToolsEnabled.
 */
(async () => {
  try {
    const state = await chrome.storage.local.get('opaDevToolsEnabled');
    if (state.opaDevToolsEnabled === false) return;
  } catch (e) {
    console.warn('[OPA] Não foi possível consultar o estado do Dev Tools:', e);
    return;
  }

  // BEGIN ORIGINAL IXC DEV TOOLS CONTENT SCRIPT
(() => {
  "use strict";
  class e {
    static createIcon(e, t, o = null, i = null) {
      const a = document.createElement("i");
      return (
        (a.id = e),
        (a.className = t),
        o && Object.assign(a.style, o),
        i && (a.title = i),
        a
      );
    }
    static createStatusBadge(e, t, o) {
      const i = document.createElement("span");
      return (
        i.setAttribute("status", t),
        (i.textContent = t),
        (i.className = e),
        (i.style.backgroundColor = o),
        (i.style.position = "absolute"),
        (i.style.top = "-12px"),
        (i.style.right = "8px"),
        (i.style.padding = "5px"),
        (i.style.borderRadius = "50%"),
        (i.style.color = "white"),
        (i.style.fontSize = "10px"),
        (i.style.fontWeight = "800"),
        i
      );
    }
    static changeIcon(e, t, o = null, i = null, a = null) {
      const s = e.className;
      e.classList.replace(e.classList[1], t),
        o && Object.assign(e.style, o),
        i && (e.title = i),
        a &&
          setTimeout(() => {
            e.className = s;
          }, a);
    }
    static changeStatusBadge(e, t, o) {
      e.setAttribute("status", t),
        (e.textContent = t),
        (e.style.backgroundColor = o);
    }
  }
  class t {
    static activeTimeout = null;
    static showNotification(e, o = 2e3) {
      let i = document.getElementById("ixc-dev-tools-notification-container");
      i ||
        ((i = document.createElement("div")),
        (i.id = "ixc-dev-tools-notification-container"),
        Object.assign(i.style, {
          position: "fixed",
          bottom: "20px",
          left: "50%",
          transform: "translateX(-50%)",
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          color: "white",
          padding: "15px 35px",
          borderRadius: "10px",
          zIndex: "9999",
          fontSize: "16px",
          display: "none",
          opacity: "0",
          transition: "opacity 0.5s",
          textAlign: "center",
        }),
        document.body.appendChild(i)),
        t.activeTimeout && clearTimeout(t.activeTimeout),
        (i.textContent = e),
        (i.style.display = "block"),
        requestAnimationFrame(() => {
          i.style.opacity = "1";
        }),
        (t.activeTimeout = setTimeout(() => {
          (i.style.opacity = "0"),
            i.addEventListener(
              "transitionend",
              () => {
                i.style.display = "none";
              },
              { once: !0 }
            );
        }, o));
    }
  }
  class o {
    static copyText(o, i) {
      navigator.clipboard
        .writeText(i)
        .then(() => {
          e.changeIcon(o, "fa-check", null, null, 2e3),
            t.showNotification(
              `"${i}" copiado com sucesso para a área de transferência.`,
              2e3
            );
        })
        .catch((e) => {
          console.error("Erro ao copiar valor para área de transferência:", e);
        });
    }
  }
  class i {
    fetchElements(e) {
      switch (e) {
        case "grid":
          return this.fetchGridElements();
        case "form":
          return this.fetchFormElements();
        case "field":
          return this.fetchFieldElements();
        default:
          throw new Error("Invalid type provided");
      }
    }
    fetchGridElements() {
      const e = document.querySelectorAll(
        ".ixc-grids.grid-global-container.flexigrid.novstripe"
      );
      return {
        gridElements: Array.from(e).map((e) => {
          let t = e
            .querySelector(".grid-overflow-ellipsis")
            ?.getAttribute("data-nome");
          if ("inner" === e.getAttribute("variant")) {
            const o = e.closest("form")?.getAttribute("name");
            o && t.startsWith(`${o}_`) && (t = t.substring(o.length + 1));
          }
          e.setAttribute("grid-name", t);
          const o = e.querySelector(".ftitle");
          Object.assign(o.style, {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          });
          const i =
            o.querySelector("#ixcdevtools-gridname-container") ||
            document.createElement("div");
          o.contains(i) ||
            ((i.id = "ixcdevtools-gridname-container"),
            i.setAttribute("data-ready", "false"),
            o.appendChild(i));
          const a =
            e.querySelector(".btn_row #ixcdevtools-buttons-container") ||
            document.createElement("div");
          return (
            e.querySelector(".btn_row").contains(a) ||
              ((a.id = "ixcdevtools-buttons-container"),
              a.setAttribute("data-ready", "false"),
              e
                .querySelector(".btn_row")
                .insertBefore(a, e.querySelector(".btn_row").firstChild)),
            { gridElement: e, gridNameElement: i, gridButtonsElement: a }
          );
        }),
      };
    }
    fetchFormElements() {
      const e = document.querySelectorAll('.modal2.ixc-modal[variant="form"]');
      return {
        formElements: Array.from(e).map((e) => {
          const t = e.querySelector(".ftitle");
          Object.assign(t.style, {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          });
          const o =
            t.querySelector("#ixcdevtools-gridname-container") ||
            document.createElement("div");
          t.contains(o) ||
            ((o.id = "ixcdevtools-gridname-container"),
            o.setAttribute("data-ready", "false"),
            t.appendChild(o));
          const i =
            e.querySelector(".btn_row #ixcdevtools-buttons-container") ||
            document.createElement("div");
          return (
            e.querySelector(".btn_row").contains(i) ||
              ((i.id = "ixcdevtools-buttons-container"),
              i.setAttribute("data-ready", "false"),
              e
                .querySelector(".btn_row")
                .insertBefore(i, e.querySelector(".btn_row").firstChild)),
            { formElement: e, formNameElement: o, formButtonsElement: i }
          );
        }),
      };
    }
    fetchFieldElements() {
      const e = document.querySelectorAll(
        '.ixc-containers[variant="field"], .ixc-containers[variant="hidden"]'
      );
      return {
        fieldElements: Array.from(e).map((e) => {
          e.setAttribute(
            "form-name",
            e.closest('.modal2.ixc-modal[variant="form"]').getAttribute("name")
          );
          const t = e.querySelector('dd[variant="input"] > *');
          e.setAttribute(
            "field-type",
            ((e) => {
              const t = e?.getAttribute("variant");
              return "select" === t || "advancedSelect" === t || "status" === t
                ? t
                : e?.getAttribute("type");
            })(t)
          );
          const o = e.querySelector('dt[variant="label"] label');
          o &&
            (Object.assign(o.style, { display: "flex", alignItems: "center" }),
            (o.title = o?.getAttribute("for"))),
            e.setAttribute("field-name", o?.getAttribute("for"));
          const i = ((e) => {
            let t =
              e?.querySelector("#ixcdevtools-buttons-container") ||
              document.createElement("div");
            return (
              e?.contains(t) ||
                ((t.id = "ixcdevtools-buttons-container"),
                t.setAttribute("data-ready", "false"),
                e?.appendChild(t)),
              t
            );
          })(o);
          return { fieldElement: e, fieldButtonsElement: i };
        }),
      };
    }
  }
  class a {
    static async toggleFixedModal(o, i, a, s = null) {
      try {
        const n = (await chrome.runtime.sendMessage({ action: "getDomain" }))
            .domain,
          r = o.getAttribute("status");
        chrome.storage.local.get(["fixedModals"], (c) => {
          let l = c.fixedModals || [];
          const d = l.filter((e) => e.domain === n),
            m = d.length > 0 ? d[0] : null;
          "OFF" === r
            ? m
              ? (t.showNotification(
                  `Já existe um modal fixado, "${m.modalName}". Clique novamente para sobrescrevê-lo.`,
                  4e3
                ),
                o.setAttribute("status", "OVERWRITE"))
              : (l.push({ domain: n, modalType: i, modalName: a, modalId: s }),
                chrome.storage.local.set({ fixedModals: l }, () => {
                  e.changeStatusBadge(o, "ON", "#28a745"),
                    t.showNotification(
                      "O modal foi fixado com sucesso. Ao recarregar a página, ele será aberto automaticamente.",
                      2e3
                    );
                }))
            : ("ON" !== r && "OVERWRITE" !== r) ||
              ("OVERWRITE" === r
                ? ((l = l.filter((e) => e.domain !== n)),
                  l.push({ domain: n, modalType: i, modalName: a, modalId: s }),
                  chrome.storage.local.set({ fixedModals: l }, () => {
                    e.changeStatusBadge(o, "ON", "#28a745"),
                      t.showNotification(
                        "O modal foi fixado e o anterior foi removido com sucesso. Ao recarregar a página, ele será aberto automaticamente.",
                        2e3
                      ),
                      o.setAttribute("status", "ON");
                  }))
                : ((l = l.filter((e) => e.domain !== n)),
                  chrome.storage.local.set({ fixedModals: l }, () => {
                    e.changeStatusBadge(o, "OFF", "red"),
                      t.showNotification(
                        "O modal foi removido com sucesso.",
                        2e3
                      ),
                      o.setAttribute("status", "OFF");
                  })));
        });
      } catch (e) {
        console.error(e.message);
      }
    }
    static async isModalSaved(e, t, o = null) {
      try {
        const i = (await chrome.runtime.sendMessage({ action: "getDomain" }))
          .domain;
        return new Promise((a, s) => {
          chrome.storage.local.get(["fixedModals"], (s) => {
            const n = (s.fixedModals || []).some(
              (a) =>
                a.domain === i &&
                a.modalName === e &&
                a.modalType === t &&
                a.modalId === o
            );
            a(n);
          });
        });
      } catch (e) {
        return console.error(e.message), !1;
      }
    }
    static async isGridModalSaved() {
      try {
        const e = (await chrome.runtime.sendMessage({ action: "getDomain" }))
          .domain;
        return new Promise((t, o) => {
          chrome.storage.local.get(["fixedModals"], (o) => {
            const i = (o.fixedModals || []).some(
              (t) => t.domain === e && "grid" === t.modalType
            );
            t(i);
          });
        });
      } catch (e) {
        return console.error(e.message), !1;
      }
    }
    static async openModals() {
      try {
        const e = (await chrome.runtime.sendMessage({ action: "getDomain" }))
          .domain;
        return new Promise((t, o) => {
          chrome.storage.local.get(["fixedModals"], (o) => {
            (o.fixedModals || [])
              .filter((t) => t.domain === e)
              .forEach((e) => {
                const t = document.createElement("script");
                (t.src = chrome.runtime.getURL("modules/externo/ixc-dev-tools/initModals.js")),
                  (document.head || document.documentElement).appendChild(t),
                  (t.onload = function () {
                    t.remove();
                  }),
                  setTimeout(() => {
                    window.postMessage(
                      { function: "initModals", modalData: e },
                      "*"
                    );
                  }, 200);
              }),
              t();
          });
        });
      } catch (e) {
        console.error(e.message);
      }
    }
  }
  const s = class {
    constructor() {
      (this.elementFetcher = null), (this.gridElements = []);
    }
    setup() {
      (this.elementFetcher = new i()), this.initializeGrids();
    }
    initializeGrids() {
      (this.gridElements =
        this.elementFetcher.fetchElements("grid").gridElements),
        this.gridElements.forEach((e) => {
          const {
              gridElement: t,
              gridNameElement: o,
              gridButtonsElement: i,
            } = e,
            a = t.getAttribute("grid-name");
          this.addGridName(a, o), this.addButtons(a, t, i);
        });
    }
    addGridName(t, i) {
      if ("true" === i.getAttribute("data-ready")) return;
      const a = e.createIcon(
        "ixcdevtools-icons-divider",
        "fa-solid fa-copy",
        { cursor: "pointer", marginLeft: "5px" },
        "Copiar"
      );
      a.addEventListener("click", () => {
        o.copyText(a, t);
      });
      const s = document.createElement("span");
      (s.textContent = `{${t}}`),
        (s.style.marginLeft = "5px"),
        i.appendChild(s),
        i.appendChild(a),
        i.setAttribute("data-ready", "true");
    }
    async addButtons(t, o, i) {
      if (
        "true" === i.getAttribute("data-ready") ||
        "inner" === o.getAttribute("variant")
      )
        return;
      (i.style.display = "flex"), (i.style.gap = "1.2rem");
      const s = document.createElement("div");
      s.style.position = "relative";
      const n = e.createIcon(
        "ixcdevtools-icons-thumbtack",
        "fa-solid fa-thumbtack",
        { fontSize: "1.7em", color: "#EBEBEB", cursor: "pointer" },
        "Fixar"
      );
      let r = "";
      const c = await a.isModalSaved(t, "grid");
      (r =
        !1 === c
          ? e.createStatusBadge("ixcdevtools-thumbtack-badge", "OFF", "red")
          : e.createStatusBadge(
              "ixcdevtools-thumbtack-badge",
              "ON",
              "#28a745"
            )),
        n.addEventListener("click", () => {
          a.toggleFixedModal(r, "grid", t);
        });
      const l = e.createIcon("ixcdevtools-icons-divider", "fa-solid fa-pipe", {
        fontSize: "1.7em",
        color: "#DDE0E1",
      });
      s.appendChild(n),
        s.appendChild(r),
        i.appendChild(s),
        i.appendChild(l),
        i.setAttribute("data-ready", "true");
    }
  };
  class n {
    static toggleHiddenFields(o, i) {
      let a = "";
      if (
        (o.classList.contains("fa-eye-low-vision")
          ? (a = "showMaker")
          : o.classList.contains("fa-eye-slash")
          ? (a = "showAll")
          : o.classList.contains("fa-eye") && (a = "hideAll"),
        "showMaker" === a)
      ) {
        const a = i.querySelectorAll(
          '.ixc-containers[variant="hidden"][style*="position: absolute"][style*="top: -5000px"]'
        );
        if (0 === a.length)
          return void t.showNotification(
            "Não foram encontrados campos ocultos.",
            2e3
          );
        a.forEach((e) => {
          e.classList.add("ixcdevtools-hidden-field-maker"),
            (e.style.position = ""),
            (e.style.top = "");
        }),
          e.changeIcon(
            o,
            "fa-eye-slash",
            null,
            "Exibir todos os campos ocultos"
          ),
          t.showNotification("Exibindo campos ocultos do Maker.", 2e3);
      } else if ("showAll" === a) {
        const a = i.querySelectorAll(
            '.ixc-containers[variant="hidden"][style*="position: absolute"][style*="top: -5000px"]'
          ),
          s = i.querySelectorAll(
            '.ixc-containers[variant="field"][style*="display: none"]'
          );
        if (0 === a.length && 0 === s.length)
          return void t.showNotification(
            "Não foram encontrados campos ocultos.",
            2e3
          );
        a.forEach((e) => {
          e.classList.add("ixcdevtools-hidden-field-maker"),
            (e.style.position = ""),
            (e.style.top = "");
        }),
          s.forEach((e) => {
            e.classList.add("ixcdevtools-hidden-field-general"),
              (e.style.display = "");
          }),
          e.changeIcon(
            o,
            "fa-eye",
            null,
            "Reverter exibição de todos os campos ocultos"
          ),
          t.showNotification(
            "Exibindo todos os campos ocultos disponíveis.",
            2e3
          );
      } else if ("hideAll" === a) {
        const a = i.querySelectorAll(".ixcdevtools-hidden-field-maker"),
          s = i.querySelectorAll(".ixcdevtools-hidden-field-general");
        if (0 === a.length && 0 === s.length)
          return void t.showNotification(
            "Não foram encontrados campos ocultos.",
            2e3
          );
        a.forEach((e) => {
          e.classList.remove("ixcdevtools-hidden-field-maker"),
            (e.style.position = "absolute"),
            (e.style.top = "-5000px");
        }),
          s.forEach((e) => {
            e.classList.remove("ixcdevtools-hidden-field-general"),
              (e.style.display = "none");
          }),
          e.changeIcon(
            o,
            "fa-eye-low-vision",
            null,
            "Exibir campos ocultos do Maker"
          ),
          t.showNotification(
            "Revertendo a exibição de todos os campos ocultos.",
            2e3
          );
      }
    }
  }
  const r = class {
    constructor() {
      (this.elementFetcher = null), (this.formElements = []);
    }
    setup() {
      (this.elementFetcher = new i()), this.initializeForms();
    }
    initializeForms() {
      (this.formElements =
        this.elementFetcher.fetchElements("form").formElements),
        this.formElements.forEach((e) => {
          const {
              formElement: t,
              formNameElement: o,
              formButtonsElement: i,
            } = e,
            a = t.getAttribute("name");
          this.addFormName(a, o), this.addButtons(a, t, i);
        });
    }
    addFormName(t, i) {
      if ("true" === i.getAttribute("data-ready")) return;
      const a = e.createIcon(
        "ixcdevtools-icons-copy",
        "fa-solid fa-copy",
        { cursor: "pointer", marginLeft: "5px" },
        "Copiar"
      );
      a.addEventListener("click", () => {
        o.copyText(a, t);
      });
      const s = document.createElement("span");
      (s.textContent = `{${t}}`),
        (s.style.marginLeft = "5px"),
        i.appendChild(s),
        i.appendChild(a),
        i.setAttribute("data-ready", "true");
    }
    async addButtons(t, o, i) {
      if (
        "true" === i.getAttribute("data-ready") ||
        "inner" === o.getAttribute("variant")
      )
        return;
      (i.style.display = "flex"), (i.style.gap = "1.2rem");
      const s = document.createElement("div");
      s.style.position = "relative";
      const r = e.createIcon(
        "ixcdevtools-icons-thumbtack",
        "fa-solid fa-thumbtack",
        { fontSize: "1.7em", color: "#DDE0E1", cursor: "pointer" },
        "Fixar"
      );
      let c = "",
        l = "",
        d = o.getAttribute("action");
      if (!d.includes("action=")) return;
      if (d.includes("action=edit")) {
        const e = /id=(\d+)/.exec(d)[1];
        (l = await a.isModalSaved(t, "form", e)),
          r.addEventListener("click", () => {
            a.toggleFixedModal(c, "form", t, e);
          });
      } else
        (l = await a.isModalSaved(t, "form")),
          r.addEventListener("click", () => {
            a.toggleFixedModal(c, "form", t);
          });
      c =
        !1 === l
          ? e.createStatusBadge("ixcdevtools-thumbtack-badge", "OFF", "red")
          : e.createStatusBadge("ixcdevtools-thumbtack-badge", "ON", "#28a745");
      const m = e.createIcon(
        "ixcdevtools-icons-eye",
        "fa-solid fa-eye-low-vision",
        { fontSize: "1.7em", color: "#DDE0E1", cursor: "pointer" },
        "Exibir campos ocultos do Maker"
      );
      m.addEventListener("click", () => {
        n.toggleHiddenFields(m, o);
      });
      const u = e.createIcon("ixcdevtools-icons-divider", "fa-solid fa-pipe", {
        fontSize: "1.7em",
        color: "#DDE0E1",
      });
      s.appendChild(r),
        s.appendChild(c),
        i.appendChild(s),
        i.appendChild(m),
        i.appendChild(u),
        i.setAttribute("data-ready", "true");
    }
  };
  const c = class {
    constructor() {
      (this.elementFetcher = null), (this.fieldDetails = []);
    }
    setup() {
      (this.elementFetcher = new i()), this.initializeFields();
    }
    initializeFields() {
      (this.fieldElements =
        this.elementFetcher.fetchElements("field").fieldElements),
        this.fieldElements.forEach((e) => {
          const { fieldElement: t, fieldButtonsElement: o } = e;
          this.addButtons(t, o);
          this.addPasswordToggleIcon(t);
        });
    }
    addPasswordToggleIcon(fieldElement) {
      const input = fieldElement.querySelector('input[type="password"]');
      if (
        input &&
        !input.parentElement.querySelector(".ixcdevtools-eye-icon")
      ) {
        let wrapper = input.parentElement;

        if (!wrapper.classList.contains("ixcdevtools-password-wrapper")) {
              wrapper = document.createElement('div');
              wrapper.style.position = 'relative';
              wrapper.className = 'ixcdevtools-password-wrapper';
              input.parentElement.insertBefore(wrapper, input);
              wrapper.appendChild(input);
        }
        console.log("Chamado corretamente o metodo para exibir a senha");
        const eye = document.createElement("span");
        eye.textContent = "👁️";
        eye.className = "ixcdevtools-eye-icon";
        eye.style.position = "absolute";
        eye.style.right = "10px";
        eye.style.top = "50%";
        eye.style.transform = "translateY(-50%)";
        eye.style.cursor = "pointer";
        eye.style.zIndex = "2";
        eye.addEventListener("click", () => {
          input.type = input.type === "password" ? "text" : "password";
        });
        input.parentElement.appendChild(eye);
      }
    }
    addButtons(t, i) {
      if ("true" === i.getAttribute("data-ready")) return;
      const a = e.createIcon(
        "ixcdevtools-icons-divider",
        "fa-solid fa-copy",
        { cursor: "pointer", marginLeft: "15px", color: "#BBBBBB" },
        "Copiar nome"
      );
      a.addEventListener("click", () => {
        o.copyText(a, t.getAttribute("field-name"));
      });
      const s = e.createIcon(
        "ixcdevtools-icons-code",
        "fa-solid fa-code",
        { cursor: "pointer", marginLeft: "10px", color: "#BBBBBB" },
        "Copiar snippet"
      );
      s.addEventListener("click", () => {
        const e = this.generateCommand(
          t.getAttribute("form-name"),
          t.getAttribute("field-type"),
          t.getAttribute("field-name")
        );
        o.copyText(s, e);
      }),
        i.appendChild(a),
        i.appendChild(s),
        i.setAttribute("data-ready", "true");
    }
    generateCommand(e, t, o) {
      let i = "";
      switch (t) {
        case "text":
        case "select":
        case "advancedSelect":
        case "password":
        case "hidden":
        case "textarea":
        case "status":
        case "color":
        default:
          i = `IXC.form('${e}').funcoes().campo('${o}').val();`;
          break;
        case "radio":
          i = `IXC.form('${e}').funcoes().campo('${o}').marcado().val();`;
          break;
        case "checkbox":
          i = `IXC.form('${e}').funcoes().campo('${o}').prop('checked');`;
      }
      return i;
    }
    getAsteriskHtml(e) {
      const t = e.querySelector('font[color="#FF0000"]');
      return t ? t.outerHTML : "";
    }
  };
  async function l(e) {
    return true; // disable the logic of activating the extension
  }
  async function d() {
    return (await chrome.runtime.sendMessage({ action: "getDomain" })).domain;
  }
  const m = (function (e, t) {
    let o;
    return function (...i) {
      clearTimeout(o), (o = setTimeout(() => e.apply(this, i), t));
    };
  })(async function (e) {
    try {
      const e = await d();
      if (!(await l(e)))
        return void console.log("Extensão desativada para este domínio.");
      new s().setup();
      new r().setup();
      new c().setup();
    } catch (e) {
      console.error("Erro ao observar mutações:", e);
    }
  }, 300);
  new (class {
    constructor(e) {
      (this.callback = e),
        (this.observer = new MutationObserver((e) => {
          e.forEach((e) => {
            "childList" === e.type && this.callback(e);
          });
        })),
        (this.targets = new Set());
    }
    startObserving(e = document.body, t = { childList: !0, subtree: !0 }) {
      if (!(e && e instanceof HTMLElement))
        throw new Error("Invalid target element provided for observation.");
      this.targets.add(e), this.observer.observe(e, t);
    }
    stopObserving(e) {
      e
        ? this.targets.has(e) &&
          (this.observer.disconnect(e), this.targets.delete(e))
        : (this.observer.disconnect(), this.targets.clear());
    }
    disconnect() {
      this.observer.disconnect(), this.targets.clear();
    }
  })(m).startObserving(),
    (async function () {
      try {
        const e = await d();
        if (!(await l(e)))
          return void console.log("Extensão desativada para este domínio.");
        a.openModals();
      } catch (e) {
        console.error("Erro ao inicializar os modais:", e);
      }
    })();
})();

  // END ORIGINAL IXC DEV TOOLS CONTENT SCRIPT
})();
