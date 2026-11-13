"use strict";

window.haraldInvolves = (() => {
  const weekdays = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const dayNumbers = [7, 1, 2, 3, 4, 5, 6];
  const styles = { 0: "0", 6: "0", 20: "0" };
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  function schedules(period) {
    return period === "Quinzenal" ? ["Atual", "Próxima"] : [""];
  }

  function column(index) {
    return index < 26 ? String.fromCharCode(65 + index) : "A" + String.fromCharCode(65 + index - 26);
  }

  function xml(text) {
    return String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
      .replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[char]);
  }

  function visitValue(value, description) {
    const order = value.match(/^([1-9][0-9]{0,2})[º°]?$/);
    if (order) return { value: order[1] + "º", order: Number(order[1]) };
    const hours = value.match(/^([01][0-9]|2[0-3]):([0-5][0-9])\s+até\s+([01][0-9]|2[0-3]):([0-5][0-9])$/i);
    if (hours) {
      const [, h1, m1, h2, m2] = hours;
      const start = 60 * Number(h1) + Number(m1);
      const end = 60 * Number(h2) + Number(m2);
      if (end > start) return { value: h1 + ":" + m1 + " até " + h2 + ":" + m2, start, end };
    }
    throw Error(description + ". Informe a ordem (1º, 2º...) ou um horário como 09:00 até 10:00.");
  }

  function buildRows(items, formData) {
    const rows = [];
    const collaborators = new Set();
    items.forEach((item, index) => {
      const name = String(formData.get(`name-${index}`) ?? "").trim();
      const period = formData.get(`period-${index}`);
      if (!name || !["Semanal", "Quinzenal"].includes(period)) throw Error("Confira o nome e o período do roteiro.");
      const key = name.toLocaleLowerCase("pt-BR");
      if (collaborators.has(key)) throw Error("Selecione somente uma sugestão por colaborador: " + name + ".");
      collaborators.add(key);
      const pdvs = new Set();
      const before = rows.length;
      const stores = item.stores.map((store, i) => {
        const suffix = `${index}-${i}`;
        if (!store.days.length || formData.has(`skip-${suffix}`)) return null;
        const pdv = String(formData.get(`pdv-${suffix}`) ?? "").trim();
        const code = String(formData.get(`code-${suffix}`) ?? "").trim();
        if (!pdv) throw Error("Confira o nome do PDV de " + store.name + ".");
        const identity = pdv.toLocaleLowerCase("pt-BR");
        if (pdvs.has(identity)) throw Error("PDV repetido no roteiro de " + name + ": " + pdv + ".");
        pdvs.add(identity);
        return { store, suffix, pdv, code, planned: false };
      }).filter(Boolean);

      schedules(period).forEach((week, weekIndex) => {
        const daily = weekdays.map(() => []);
        for (const entry of stores) {
          const { store, suffix, pdv, code } = entry;
          const values = dayNumbers.map((day, dayIndex) => {
            if (!store.days.includes(day)) return "";
            const raw = String(formData.get(`visit-${suffix}-${weekIndex}-${day}`) ?? "").trim();
            if (!raw) return "";
            const context = [name, pdv, week, weekdays[dayIndex]].filter(Boolean).join(" · ");
            const visit = visitValue(raw, context);
            const conflicts = daily[dayIndex].some((other) => visit.order
              ? other.order === visit.order
              : other.start < visit.end && visit.start < other.end);
            if (conflicts) throw Error(context + ". Há ordem repetida ou horários sobrepostos nesse dia.");
            daily[dayIndex].push(visit);
            return visit.value;
          });
          if (!values.some(Boolean)) continue;
          entry.planned = true;
          const row = Array(21).fill("");
          row[0] = name;
          row[4] = week;
          row[5] = code;
          row[6] = pdv;
          row[20] = period;
          rows.push(row.concat(values));
        }
      });
      const missing = stores.find((entry) => !entry.planned);
      if (missing) throw Error("Preencha uma visita ou marque Excluir da exportação para " + missing.pdv + ".");
      if (rows.length === before) throw Error("Preencha pelo menos uma visita para " + name + ".");
    });
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

  return { weekdays, dayNumbers, schedules, buildRows, makeXlsx, download };
})();
