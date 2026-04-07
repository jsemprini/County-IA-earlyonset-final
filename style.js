let countyData = [];
let iowaGeoJSON = null;

const DATA_FILE = "IA-County-clean.csv";
const COUNTY_GEOJSON_URL = "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json";

const siteSelect = document.getElementById("siteSelect");
const sexSelect = document.getElementById("sexSelect");
const outcomeSelect = document.getElementById("outcomeSelect");
const periodSelect = document.getElementById("periodSelect");
const resetButton = document.getElementById("resetButton");
const chartDiv = document.getElementById("chart");
const tableDiv = document.getElementById("table");
const selectionSummary = document.getElementById("selectionSummary");
const mapSubtitle = document.getElementById("mapSubtitle");

async function loadData() {
  try {
    const [csvResponse, geoResponse] = await Promise.all([
      fetch(DATA_FILE),
      fetch(COUNTY_GEOJSON_URL)
    ]);

    if (!csvResponse.ok) {
      throw new Error(`Could not load ${DATA_FILE}`);
    }
    if (!geoResponse.ok) {
      throw new Error("Could not load county GeoJSON.");
    }

    const csvText = await csvResponse.text();
    const geojson = await geoResponse.json();

    countyData = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true
    }).data;

    countyData.forEach(d => {
      d.FIPS = String(d.FIPS || "").padStart(5, "0");
    });

    iowaGeoJSON = {
      type: "FeatureCollection",
      features: geojson.features.filter(f => String(f.id).startsWith("19"))
    };

    populateFilters();
    updateView();
  } catch (err) {
    chartDiv.innerHTML = `<div class="warning">${err.message}</div>`;
    tableDiv.innerHTML = "";
    console.error(err);
  }
}

function uniqueSorted(values) {
  return [...new Set(values.filter(v => v !== undefined && v !== null && v !== ""))].sort();
}

function populateFilters() {
  const sexOptions = uniqueSorted(countyData.map(d => d.Sex));
  const siteOptions = uniqueSorted(countyData.map(d => d.Site));

  sexSelect.innerHTML = "";
  siteSelect.innerHTML = "";

  sexOptions.forEach(v => {
    const option = document.createElement("option");
    option.value = v;
    option.text = v;
    sexSelect.add(option);
  });

  siteOptions.forEach(v => {
    const option = document.createElement("option");
    option.value = v;
    option.text = v;
    siteSelect.add(option);
  });

  resetSelections();
}

function resetSelections() {
  const sexOptions = [...sexSelect.options].map(o => o.value);
  const siteOptions = [...siteSelect.options].map(o => o.value);

  if (siteOptions.includes("All Sites")) {
    siteSelect.value = "All Sites";
  } else if (siteOptions.length > 0) {
    siteSelect.value = siteOptions[0];
  }

  if (sexOptions.includes("Both")) {
    sexSelect.value = "Both";
  } else if (sexOptions.length > 0) {
    sexSelect.value = sexOptions[0];
  }

  outcomeSelect.value = "Cancer";
  periodSelect.value = "Percentage Change";
}

function cleanNumeric(value) {
  if (value === null || value === undefined) return null;

  const str = String(value).trim();
  if (str === "") return null;

  const cleaned = str.replaceAll(",", "").replaceAll("%", "");
  const num = Number(cleaned);

  return Number.isFinite(num) ? num : null;
}

function findValueColumn(columns, outcome, period) {
  const lowerMap = {};
  columns.forEach(c => {
    lowerMap[c] = c.toLowerCase();
  });

  const keyword = outcome === "Cancer" ? "rate" : "pop";

  if (period === "2000-2011") {
    return columns.filter(c =>
      lowerMap[c].includes(keyword) && lowerMap[c].endsWith("_0011")
    );
  }

  if (period === "2012-2022") {
    return columns.filter(c =>
      lowerMap[c].includes(keyword) && lowerMap[c].endsWith("_1222")
    );
  }

  if (period === "Percentage Change") {
    return columns.filter(c =>
      lowerMap[c].includes(keyword) && lowerMap[c].includes("pc_")
    );
  }

  return [];
}

function formatValue(value, period) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "NA";
  return period === "Percentage Change" ? `${value.toFixed(2)}%` : value.toFixed(2);
}

function valueClass(value) {
  if (!Number.isFinite(value)) return "";
  if (value > 0) return "value-positive";
  if (value < 0) return "value-negative";
  return "value-neutral";
}

function updateSummary(site, sex, outcome, period, valueCol, count) {
  selectionSummary.innerHTML = `
    <strong>Current Selection</strong>
    Site: ${site}<br>
    Sex: ${sex}<br>
    Outcome: ${outcome}<br>
    Period: ${period}<br>
    Data column: ${valueCol}<br>
    Counties with data: ${count}
  `;

  mapSubtitle.textContent = `${site} | ${sex} | ${outcome} | ${period}`;
}

function updateView() {
  const site = siteSelect.value;
  const sex = sexSelect.value;
  const outcome = outcomeSelect.value;
  const period = periodSelect.value;

  const filtered = countyData.filter(d => d.Site === site && d.Sex === sex);

  if (filtered.length === 0) {
    selectionSummary.innerHTML = "<strong>Current Selection</strong>No rows found for the current filters.";
    chartDiv.innerHTML = `<div class="warning">No rows found for Site = ${site}, Sex = ${sex}.</div>`;
    tableDiv.innerHTML = "";
    return;
  }

  const columns = Object.keys(filtered[0]);
  const matches = findValueColumn(columns, outcome, period);

  if (matches.length === 0) {
    selectionSummary.innerHTML = "<strong>Current Selection</strong>No matching data column was found.";
    chartDiv.innerHTML = `<div class="warning">No column matched Outcome = ${outcome} and Period = ${period}.</div>`;
    tableDiv.innerHTML = "";
    return;
  }

  if (matches.length > 1) {
    selectionSummary.innerHTML = "<strong>Current Selection</strong>Multiple matching data columns were found.";
    chartDiv.innerHTML = `<div class="warning">Multiple columns matched: ${matches.join(", ")}. Tighten the matching logic in script.js.</div>`;
    tableDiv.innerHTML = "";
    return;
  }

  const valueCol = matches[0];

  const validCount = filtered
    .map(d => cleanNumeric(d[valueCol]))
    .filter(v => v !== null).length;

  updateSummary(site, sex, outcome, period, valueCol, validCount);
  renderMap(filtered, valueCol, outcome, period, site, sex);
  renderTable(filtered, valueCol, outcome, period);
}

function renderMap(rows, valueCol, outcome, period, site, sex) {
  const mapRows = rows
    .map(d => ({
      FIPS: String(d.FIPS).padStart(5, "0"),
      county: d.County || d.COUNTY || d.NAME || d.FIPS,
      value: cleanNumeric(d[valueCol])
    }))
    .filter(d => d.FIPS.startsWith("19"));

  const validRows = mapRows.filter(d => d.value !== null);

  if (validRows.length === 0) {
    chartDiv.innerHTML = `<div class="warning">The selected column (${valueCol}) has no numeric values after cleaning.</div>`;
    return;
  }

  let colorscale;
  let zmin;
  let zmax;

  if (period === "Percentage Change") {
    const maxAbs = Math.max(...validRows.map(d => Math.abs(d.value)), 1);
    zmin = -maxAbs;
    zmax = maxAbs;
    colorscale = [
      [0.0, "#2b55c7"],
      [0.5, "#e5e7eb"],
      [1.0, "#d92929"]
    ];
  } else {
    const vals = validRows.map(d => d.value);
    zmin = Math.min(...vals);
    zmax = Math.max(...vals);
    if (zmin === zmax) zmax = zmin + 1e-9;

    colorscale = [
      [0.0, "#fff5f0"],
      [0.2, "#fee0d2"],
      [0.4, "#fcbba1"],
      [0.6, "#fc9272"],
      [0.8, "#fb6a4a"],
      [1.0, "#cb181d"]
    ];
  }

  const trace = {
    type: "choropleth",
    geojson: iowaGeoJSON,
    featureidkey: "id",
    locations: validRows.map(d => d.FIPS),
    z: validRows.map(d => d.value),
    text: validRows.map(d => d.county),
    hovertemplate:
      "<b>%{text}</b><br>" +
      `Value: %{z:.2f}` +
      (period === "Percentage Change" ? "%" : "") +
      "<extra></extra>",
    colorscale: colorscale,
    zmin: zmin,
    zmax: zmax,
    marker: {
      line: {
        color: "#3b3b3b",
        width: 0.65
      }
    },
    colorbar: {
      title: {
        text: outcome === "Cancer"
          ? (period === "Percentage Change" ? "Percent change" : "Cancer value")
          : (period === "Percentage Change" ? "Percent change" : "Population value"),
        side: "bottom"
      },
      orientation: "h",
      thickness: 16,
      len: 0.62,
      x: 0.5,
      xanchor: "center",
      y: -0.1,
      tickfont: {
        size: 11
      }
    }
  };

  const layout = {
    title: {
      text: `${site} | ${sex} | ${outcome} | ${period}`,
      x: 0.5,
      xanchor: "center",
      font: {
        size: 18
      }
    },
    margin: { l: 10, r: 10, t: 60, b: 85 },
    geo: {
      fitbounds: "locations",
      visible: false,
      showcountries: false,
      showlakes: false,
      showland: true,
      landcolor: "white",
      bgcolor: "white"
    },
    paper_bgcolor: "white",
    plot_bgcolor: "white"
  };

  Plotly.newPlot(chartDiv, [trace], layout, {
    responsive: true,
    displayModeBar: false
  });
}

function renderTable(rows, valueCol, outcome, period) {
  const tableRows = rows
    .map(d => ({
      county: d.County || d.COUNTY || d.NAME || d.FIPS,
      fips: String(d.FIPS).padStart(5, "0"),
      value: cleanNumeric(d[valueCol])
    }))
    .filter(d => d.value !== null)
    .sort((a, b) => b.value - a.value);

  let html = `
    <p class="table-note">
      <strong>Current ranking</strong><br>
      ${outcome} | ${period} | ${valueCol}
    </p>
  `;

  html += `
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>County</th>
          <th>FIPS</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
  `;

  tableRows.forEach((d, i) => {
    html += `
      <tr>
        <td>${i + 1}</td>
        <td>${d.county}</td>
        <td>${d.fips}</td>
        <td class="${valueClass(d.value)}">${formatValue(d.value, period)}</td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  tableDiv.innerHTML = html;
}

siteSelect.onchange = updateView;
sexSelect.onchange = updateView;
outcomeSelect.onchange = updateView;
periodSelect.onchange = updateView;

resetButton.onclick = () => {
  resetSelections();
  updateView();
};

loadData();
