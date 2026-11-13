"use strict";

window.haraldInvolves = (() => {
  const dayNumbers = [7, 1, 2, 3, 4, 5, 6];
  const styles = { 0: "0", 6: "0", 20: "0" };
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  });

  function dayKey(value) {
    const parts = Object.fromEntries(dateParts.formatToParts(new Date(value)).map(({type, value}) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function dateRange(period, now = new Date()) {
    const today = dayKey(now);
    const calendar = new Date(today + "T00:00:00Z");
    if (period === "yesterday") {
      calendar.setUTCDate(calendar.getUTCDate() - 1);
      const yesterday = calendar.toISOString().slice(0, 10);
      return [yesterday, yesterday];
    }
    if (period === "week") calendar.setUTCDate(calendar.getUTCDate() - (calendar.getUTCDay() + 6) % 7);
    if (period === "month") calendar.setUTCDate(1);
    return [calendar.toISOString().slice(0, 10), today];
  }

  function column(index) {
    return index < 26 ? String.fromCharCode(65 + index) : "A" + String.fromCharCode(65 + index - 26);
  }

  function xml(text) {
    return String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
      .replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[char]);
  }

  // The API returns newest submissions first, including between pages.
  function buildRows(items) {
    const rows = [];
    const collaborators = new Set();
    for (const item of items) {
      const name = String(item.promoter ?? "").trim();
      const key = name.toLocaleLowerCase("pt-BR");
      if (!name || collaborators.has(key)) continue;
      collaborators.add(key);
      const stores = new Map();
      for (const store of item.stores) {
        const pdv = String(store.name ?? "").trim();
        if (!pdv || !store.days.length) continue;
        const identity = pdv.toLocaleLowerCase("pt-BR");
        const entry = stores.get(identity) ?? { pdv, days: new Set() };
        store.days.forEach((day) => entry.days.add(day));
        stores.set(identity, entry);
      }
      const order = Array(7).fill(0);
      for (const {pdv, days} of stores.values()) {
        const row = Array(21).fill("");
        row[0] = name;
        row[6] = pdv;
        row[20] = "Semanal";
        rows.push(row.concat(dayNumbers.map((day, index) => days.has(day) ? ++order[index] + "º" : "")));
      }
    }
    return rows;
  }

  function makeXlsx(rows, template, zip) {
    const path = "xl/worksheets/sheet1.xml";
    const files = zip.unzipSync(Uint8Array.from(atob(template), (ch) => ch.charCodeAt(0)));
    const sheet = zip.strFromU8(files[path]);
    const addedRows = rows.map((values, i) => {
      const n = i + 2;
      const cells = values.map((value, j) => {
        const open = `<c r="${column(j)}${n}" s="${styles[j] || "3"}"`;
        return value ? `${open} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>` : open + "/>";
      }).join("");
      return `<row r="${n}" ht="35.1" customHeight="true">${cells}</row>`;
    }).join("");
    files[path] = zip.strToU8(sheet.replace('ref="A1:AB1"', `ref="A1:AB${rows.length + 1}"`)
      .replace("</sheetData>", () => addedRows + "</sheetData>"));
    return zip.zipSync(files);
  }

  function download(rows, test = false) {
    const bytes = makeXlsx(rows, window.haraldInvolvesTemplate, window.fflate);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const link = Object.assign(document.createElement("a"), { href: url, download: (test ? "TESTE_" : "") + "import_roteiros_relatorio.xlsx" });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { dayKey, dateRange, buildRows, makeXlsx, download };
})();
