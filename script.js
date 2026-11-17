// Beeswarm of Austin shelter dog stays, drawn with D3.
// y = days in the shelter (never changes)
// x = a column per group; scrolling swaps which grouping is used

const DATA_URL = "data/dogs.json";
const MS_PER_DAY = 1000 * 60 * 60 * 24;

// ---------- The two ways of grouping dogs ----------

// The shelter's color field is free text ("Brown Brindle", "Buff", ...),
// so the colors are bucketed into a few groups here.
const COAT_GROUPS = [
  { key: "black", label: "Black", fill: "#2b2623", names: ["black", "black brown"] },
  { key: "white", label: "White", fill: "#fffdf7", names: ["white", "albino"] },
  { key: "brown", label: "Brown", fill: "#7a4a2b", names: ["brown", "chocolate", "liver", "bronze"] },
  {
    key: "tan",
    label: "Tan & cream",
    fill: "#dcb783",
    names: ["tan", "cream", "buff", "fawn", "gold", "blonde", "apricot", "yellow", "yellow gold", "wheaten", "silver fawn"],
  },
  { key: "red", label: "Red", fill: "#b5532a", names: ["red", "red brown", "rust", "chestnut", "cinnamon"] },
  { key: "grey", label: "Grey & blue", fill: "#7f8d9b", names: ["grey", "blue", "silver", "charcoal", "ghost grey"] },
  { key: "brindle", label: "Brindle", fill: "#a8862a", names: [] },
  { key: "other", label: "Patterned & other", fill: "#3f8f86", names: [] },
];

const AGE_GROUPS = [
  { key: "a0", label: "Under 6 mo", maxYears: 0.5 },
  { key: "a1", label: "6–12 mo", maxYears: 1 },
  { key: "a2", label: "1–2 yr", maxYears: 2 },
  { key: "a3", label: "2–5 yr", maxYears: 5 },
  { key: "a4", label: "5–8 yr", maxYears: 8 },
  { key: "a5", label: "8+ yr", maxYears: Infinity },
];

const VIEWS = {
  color: { key: "color", title: "Days in the shelter, by coat color", field: "coatGroup", groups: COAT_GROUPS },
  age: { key: "age", title: "Days in the shelter, by age at arrival", field: "ageGroup", groups: AGE_GROUPS },
};

function coatGroupOf(colorName) {
  const name = colorName.toLowerCase();
  if (name.includes("brindle")) return "brindle";
  const match = COAT_GROUPS.find((group) => group.names.includes(name));
  return match ? match.key : "other"; // tri color, merle, sable, unknown...
}

function ageGroupOf(years) {
  return AGE_GROUPS.find((group) => years < group.maxYears).key;
}

// ---------- Page state ----------

let dogs = [];
let currentView = "color";
let size = { width: 0, height: 0 };
let yScale;

const svg = d3.select("#swarm");
const gridLayer = svg.append("g");
const columnLayer = svg.append("g");
const dotLayer = svg.append("g");
const medianLayer = svg.append("g");
const tooltip = document.querySelector("#tooltip");
const chartBox = document.querySelector("#chart");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Load and prepare the data ----------

async function loadDogs() {
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error("Could not load " + DATA_URL);
  const records = await response.json();

  return records.map(function (record, index) {
    const intake = new Date(record.intakeDate);
    const outcome = new Date(record.outcomeDate);
    const ageYears = (intake - new Date(record.birthDate)) / MS_PER_DAY / 365.25;
    return {
      ...record,
      days: (outcome - intake) / MS_PER_DAY,
      ageYears: ageYears,
      coatGroup: coatGroupOf(record.color),
      ageGroup: ageGroupOf(ageYears),
      order: index,
      x: {}, // one x position per view, filled in by layoutView()
      y: 0,
    };
  });
}

// ---------- Layout ----------

function getMargins() {
  const narrow = size.width < 600;
  const left = narrow ? 62 : 74;
  // When the eight coat columns get skinny their labels tilt, which needs more room
  const tiltedLabels = (size.width - left - 8) / COAT_GROUPS.length < 80;
  return { top: 14, right: 8, bottom: tiltedLabels ? 84 : 44, left: left };
}

function dotRadius() {
  // Dots shrink with the width of the skinniest columns (the eight coat colors)
  const margin = getMargins();
  const band = (size.width - margin.left - margin.right) / COAT_GROUPS.length;
  return Math.min(3.2, Math.max(1.9, band / 22));
}

// Places every dog in its column for one view. Each dot keeps its exact y and
// is nudged sideways until it stops touching dots that are already placed.
function layoutView(view) {
  const margin = getMargins();
  const band = (size.width - margin.left - margin.right) / view.groups.length;
  const halfWidth = band / 2 - 3;
  const radius = dotRadius();
  const gap = radius * 2 + 0.6;
  const step = radius * 0.5;

  view.groups.forEach(function (group, groupIndex) {
    const center = margin.left + band * (groupIndex + 0.5);
    const members = dogs.filter((dog) => dog[view.field] === group.key).sort((a, b) => a.y - b.y);
    const placed = [];

    members.forEach(function (dog, memberIndex) {
      const firstSide = memberIndex % 2 === 0 ? 1 : -1;
      let offset = null;

      for (let k = 0; k * step <= halfWidth && offset === null; k++) {
        for (const side of [firstSide, -firstSide]) {
          const tryOffset = side * k * step;
          if (!touches(placed, tryOffset, dog.y, gap)) {
            offset = tryOffset;
            break;
          }
        }
      }

      // Column is full at this height: let the dot overlap inside its column
      if (offset === null) {
        offset = (((dog.order * 37) % 100) / 50 - 1) * halfWidth;
      }

      placed.push({ x: offset, y: dog.y });
      dog.x[view.key] = center + offset;
    });

    group.center = center;
    group.halfWidth = halfWidth;
    group.count = members.length;
    group.median = d3.median(members, (dog) => dog.days);
  });
}

function touches(placed, x, y, gap) {
  // "placed" is sorted by y, so only the most recent dots can be close enough
  for (let i = placed.length - 1; i >= 0; i--) {
    const dy = y - placed[i].y;
    if (dy >= gap) break;
    const dx = x - placed[i].x;
    if (dx * dx + dy * dy < gap * gap) return true;
  }
  return false;
}

// ---------- Drawing ----------

const DAY_TICKS = [
  { days: 0, label: "Same day" },
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "1 month" },
  { days: 90, label: "3 months" },
  { days: 180, label: "6 months" },
  { days: 365, label: "1 year" },
  { days: 730, label: "2 years" },
];

// Measures the chart box, rebuilds the scale and both layouts, then draws
function resizeChart() {
  size = { width: chartBox.clientWidth, height: chartBox.clientHeight };
  if (size.width === 0 || size.height === 0) return;
  const margin = getMargins();

  svg.attr("viewBox", `0 0 ${size.width} ${size.height}`);

  // Log scale on (days + 1) so same-day stays still have a place to sit
  const maxDays = d3.max(dogs, (dog) => dog.days);
  yScale = d3
    .scaleLog()
    .domain([1, maxDays + 1])
    .range([size.height - margin.bottom, margin.top]);

  dogs.forEach((dog) => (dog.y = yScale(dog.days + 1)));
  dogs.sort((a, b) => a.order - b.order);
  Object.values(VIEWS).forEach(layoutView);

  drawAxis(margin, maxDays);
  drawDots();
  drawColumns(false);
  writeStat(VIEWS.color, "#stat-color");
  writeStat(VIEWS.age, "#stat-age");
}

function drawAxis(margin, maxDays) {
  const ticks = DAY_TICKS.filter((tick) => tick.days <= maxDays);

  gridLayer
    .selectAll("line")
    .data(ticks)
    .join("line")
    .attr("class", "grid-line")
    .attr("x1", margin.left - 4)
    .attr("x2", size.width - margin.right)
    .attr("y1", (tick) => yScale(tick.days + 1))
    .attr("y2", (tick) => yScale(tick.days + 1));

  gridLayer
    .selectAll("text")
    .data(ticks)
    .join("text")
    .attr("class", "axis-label")
    .attr("x", margin.left - 8)
    .attr("y", (tick) => yScale(tick.days + 1))
    .attr("dy", "0.32em")
    .attr("text-anchor", "end")
    .text((tick) => tick.label);
}

function drawDots() {
  dotLayer
    .selectAll("circle")
    .data(dogs, (dog) => dog.id)
    .join("circle")
    .attr("class", "dot")
    .attr("r", dotRadius())
    .attr("fill", (dog) => COAT_GROUPS.find((group) => group.key === dog.coatGroup).fill)
    .interrupt()
    .attr("cx", (dog) => dog.x[currentView])
    .attr("cy", (dog) => dog.y);
}

// Column labels and median marks for the current view
function drawColumns(animate) {
  const view = VIEWS[currentView];
  const margin = getMargins();
  const baseline = size.height - margin.bottom;
  const tilted = view.groups[0].halfWidth < 37;
  const fade = animate && !reduceMotion ? 500 : 0;

  columnLayer.selectAll("*").remove();
  medianLayer.selectAll("*").remove();

  const columns = columnLayer
    .selectAll("g")
    .data(view.groups)
    .join("g")
    .attr("transform", (group) => `translate(${group.center}, ${baseline + 16})`);

  columns
    .append("text")
    .attr("class", "column-label")
    .attr("text-anchor", tilted ? "end" : "middle")
    .attr("transform", tilted ? "rotate(-40)" : null)
    .text((group) => group.label);

  if (!tilted) {
    columns
      .append("text")
      .attr("class", "column-count")
      .attr("text-anchor", "middle")
      .attr("y", 15)
      .text((group) => group.count + " dogs");
  }

  const medians = medianLayer
    .selectAll("g")
    .data(view.groups.filter((group) => group.count > 0))
    .join("g")
    .attr("transform", (group) => `translate(${group.center}, ${yScale(group.median + 1)})`);

  medians
    .append("line")
    .attr("class", "median-line")
    .attr("x1", (group) => -group.halfWidth)
    .attr("x2", (group) => group.halfWidth);

  medians
    .append("text")
    .attr("class", "median-label")
    .attr("text-anchor", "middle")
    .attr("y", -5)
    .text((group) => Math.round(group.median) + (tilted ? "d" : " days"));

  columnLayer.attr("opacity", 0).transition().duration(fade).attr("opacity", 1);
  medianLayer.attr("opacity", 0).transition().delay(fade).duration(fade).attr("opacity", 1);

  document.querySelector("#chart-title").textContent = view.title;
  document.querySelector("#chart-summary").textContent =
    view.title + ". " +
    view.groups.map((group) => `${group.label}: ${group.count} dogs, median ${Math.round(group.median)} days`).join(". ") + ".";
}

// Slides every dot sideways to its column in the new view. cy is not touched.
function showView(viewKey) {
  if (viewKey === currentView || !VIEWS[viewKey]) return;
  currentView = viewKey;
  hideTooltip();
  if (size.width === 0) return; // nothing drawn yet; resizeChart() will use currentView

  dotLayer
    .selectAll("circle")
    .transition()
    .duration(reduceMotion ? 0 : 1100)
    .delay((dog) => (reduceMotion ? 0 : (dog.order % 40) * 10))
    .ease(d3.easeCubicInOut)
    .attr("cx", (dog) => dog.x[viewKey]);

  drawColumns(true);
}

// ---------- Legend and step text ----------

function drawLegend() {
  const legend = document.querySelector("#legend");
  legend.innerHTML = "";
  COAT_GROUPS.forEach(function (group) {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = group.fill;
    item.append(swatch, group.label);
    legend.append(item);
  });
}

function writeStat(view, elementId) {
  const groups = view.groups.filter((group) => group.count >= 15);
  const longest = d3.greatest(groups, (group) => group.median);
  const shortest = d3.least(groups, (group) => group.median);
  document.querySelector(elementId).textContent =
    `Longest typical wait: ${longest.label}, ${Math.round(longest.median)} days. ` +
    `Shortest: ${shortest.label}, ${Math.round(shortest.median)} days.`;
}

// ---------- Tooltip ----------

function describeAge(years) {
  if (years < 1) return Math.max(1, Math.round(years * 12)) + " months old";
  return Math.round(years) + (Math.round(years) === 1 ? " year old" : " years old");
}

function describeStay(days) {
  if (days < 1) return "less than a day";
  return Math.round(days) + (Math.round(days) === 1 ? " day" : " days");
}

function showTooltip(event) {
  const dog = d3.select(event.target).datum();
  if (!dog) return;

  dotLayer.selectAll(".is-hovered").classed("is-hovered", false);
  d3.select(event.target).classed("is-hovered", true);

  const coat = dog.secondaryColor ? `${dog.color} and ${dog.secondaryColor}` : dog.color;
  tooltip.innerHTML = "";
  const name = document.createElement("strong");
  name.textContent = dog.name || "Unnamed " + dog.type.toLowerCase();
  tooltip.append(
    name,
    `${dog.breed}, ${coat.toLowerCase()}`,
    document.createElement("br"),
    `${describeAge(dog.ageYears)} at arrival`,
    document.createElement("br"),
    `In shelter ${describeStay(dog.days)} · ${dog.outcome}`
  );
  tooltip.hidden = false;

  // Keep the tooltip inside the chart box
  const dotX = Number(event.target.getAttribute("cx"));
  const left = Math.min(Math.max(dotX - tooltip.offsetWidth / 2, 4), size.width - tooltip.offsetWidth - 4);
  const above = dog.y - tooltip.offsetHeight - 10;
  tooltip.style.left = left + "px";
  tooltip.style.top = (above < 0 ? dog.y + 12 : above) + "px";
}

function hideTooltip() {
  tooltip.hidden = true;
  dotLayer.selectAll(".is-hovered").classed("is-hovered", false);
}

// ---------- Scroll steps ----------

// The active step is the last one whose top has crossed a trigger line
function updateActiveStep() {
  const steps = Array.from(document.querySelectorAll(".step"));
  const isDesktop = window.matchMedia("(min-width: 800px)").matches;
  const triggerLine = window.innerHeight * (isDesktop ? 0.6 : 0.88);

  let active = steps[0];
  steps.forEach(function (step) {
    if (step.getBoundingClientRect().top < triggerLine) active = step;
  });

  steps.forEach((step) => step.classList.toggle("is-active", step === active));
  showView(active.dataset.view);
}

// ---------- Start ----------

async function start() {
  try {
    dogs = await loadDogs();
  } catch (error) {
    document.querySelector("#chart-title").textContent = "Sorry, the shelter data could not be loaded.";
    console.error(error);
    return;
  }

  drawLegend();
  // The observer fires once right away, and again whenever the chart box changes size
  new ResizeObserver(resizeChart).observe(chartBox);
  updateActiveStep();
  window.addEventListener("scroll", updateActiveStep, { passive: true });
  dotLayer.on("pointerover", showTooltip).on("pointerout", hideTooltip);
}

start();
