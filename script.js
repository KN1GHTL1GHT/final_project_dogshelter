// Beeswarm of Austin shelter dog stays, drawn with D3.
// The dots are painted on a <canvas> (thousands of SVG circles are too slow
// to animate); the axis labels, column labels and medians are SVG on top.
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

// Breed is also free text (110 different names in this sample), and shelter
// breed labels are often a best guess from looks. These are broad buckets.
const BREED_GROUPS = [
  { key: "pit", label: "Pit bull type" },
  { key: "retriever", label: "Labs & retrievers" },
  { key: "shepherd", label: "Shepherds" },
  { key: "small", label: "Small breeds" },
  { key: "guardian", label: "Guardians & mastiffs" },
  { key: "herding", label: "Herding" },
  { key: "hound", label: "Hounds & pointers" },
  { key: "northern", label: "Huskies & spitz" },
  { key: "other", label: "Mixed & other" },
];

const VIEWS = {
  color: { key: "color", title: "Days in the shelter, by coat color", field: "coatGroup", groups: COAT_GROUPS },
  age: { key: "age", title: "Days in the shelter, by age at arrival", field: "ageGroup", groups: AGE_GROUPS },
  breed: { key: "breed", title: "Days in the shelter, by breed group", field: "breedGroup", groups: BREED_GROUPS },
};

// The view with the most columns decides how small the dots and margins get
const MOST_COLUMNS = Math.max(COAT_GROUPS.length, AGE_GROUPS.length, BREED_GROUPS.length);

function coatGroupOf(colorName) {
  const name = colorName.toLowerCase();
  if (name.includes("brindle")) return "brindle";
  const match = COAT_GROUPS.find((group) => group.names.includes(name));
  return match ? match.key : "other"; // tri color, merle, sable, unknown...
}

// The order of these checks matters: "French Bulldog" has to be caught as a
// small breed before "bulldog" is checked, and so on.
function breedGroupOf(breedName) {
  const name = breedName.toLowerCase();
  const hasAny = (words) => words.some((word) => name.includes(word));

  if (hasAny(["pit bull", "staffordshire", "bull terrier"])) return "pit";
  if (hasAny(["retriever", "labradoodle"])) return "retriever";
  if (hasAny(["cattle dog", "collie", "australian shepherd", "kelpie", "corgi", "sheep dog", "blue lacy"])) return "herding";
  if (
    hasAny([
      "pyrenees", "anatolian", "kangal", "rottweiler", "boxer", "american bulldog", "english bulldog", "mastiff",
      "doberman", "great dane", "cane corso", "boerboel", "saint bernard", "dogo", "shar pei",
    ])
  ) {
    return "guardian";
  }
  if (hasAny(["shepherd", "malinois", "beauceron"])) return "shepherd";
  if (hasAny(["husky", "akita", "spitz", "shiba", "chow"])) return "northern";
  if (
    hasAny([
      "chihuahua", "terrier", "shih tzu", "dachshund", "poodle - miniature", "poodle - toy", "schnauzer - miniature",
      "pug", "french bulldog", "cavalier", "pinscher", "havanese", "pekingese", "schipperke",
    ])
  ) {
    return "small";
  }
  if (hasAny(["hound", "pointer", "mouth cur", "mountain cur", "catahoula", "beagle", "vizsla", "ridgeback", "setter", "weimaraner", "griffon"])) {
    return "hound";
  }
  return "other"; // mixed breed, standard poodle, dalmatian, unknown...
}

function ageGroupOf(years) {
  return AGE_GROUPS.find((group) => years < group.maxYears).key;
}

// ---------- Page state ----------

let dogs = [];
let currentView = "color";
let size = { width: 0, height: 0 };
let yScale;
let currentRadius = 3;
let visibleTicks = [];
let hoveredDog = null;
let slideTimer = null;
let medianOpacity = 1; // the median lines fade in while the dots slide

const svg = d3.select("#swarm");
const gridLayer = svg.append("g");
const columnLayer = svg.append("g");
const medianLayer = svg.append("g");
const canvas = document.querySelector("#dots");
const context = canvas.getContext("2d");
const tooltip = document.querySelector("#tooltip");
const chartBox = document.querySelector("#chart");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Load and prepare the data ----------

async function loadDogs() {
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error("Could not load " + DATA_URL);
  const file = await response.json();

  // The file stores each dog as a short array to save space. Turn every one
  // back into an object like { id: "13060", name: null, type: "Dog", ... }
  const records = file.dogs.map(function (row) {
    const record = {};
    file.columns.forEach((column, index) => (record[column] = row[index]));
    return record;
  });

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
      breedGroup: breedGroupOf(record.breed),
      order: index,
      x: {}, // one x position per view, filled in by layoutView()
      y: 0,
      drawX: 0, // where the dot is painted right now (changes during a slide)
      slideFrom: 0,
      slideDelay: (index % 40) * 10, // milliseconds, so dots don't all leave at once
    };
  });
}

// ---------- Layout ----------

function getMargins() {
  const narrow = size.width < 600;
  const left = narrow ? 62 : 74;
  // When the columns get skinny their labels tilt, which needs more room
  const tiltedLabels = (size.width - left - 8) / MOST_COLUMNS < 88;
  return { top: 14, right: 8, bottom: tiltedLabels ? 96 : 44, left: left };
}

// Picks a dot size that lets the most crowded column of any view still fit:
// the more dogs that share a column, the smaller every dot has to be.
function dotRadius() {
  const margin = getMargins();
  const plotWidth = size.width - margin.left - margin.right;
  const plotHeight = size.height - margin.top - margin.bottom;

  const roomPerDog = d3.min(Object.values(VIEWS), function (view) {
    const band = plotWidth / view.groups.length;
    const biggest = d3.max(view.groups, (group) => dogs.filter((dog) => dog[view.field] === group.key).length);
    return (band * plotHeight) / biggest;
  });

  return Math.min(3.2, Math.max(0.9, Math.sqrt(roomPerDog) * 0.25));
}

// Places every dog in its column for one view. Each dot keeps its exact y and
// is nudged sideways until it stops touching dots that are already placed.
function layoutView(view) {
  const margin = getMargins();
  const band = (size.width - margin.left - margin.right) / view.groups.length;
  const halfWidth = band / 2 - 6; // dots stay inside this
  const lineHalfWidth = band / 2 - 1; // the median line pokes out past the dots
  const radius = currentRadius;
  const gap = radius * 2 + Math.min(0.6, radius * 0.3);
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
    group.lineHalfWidth = lineHalfWidth;
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

// Measures the chart box, rebuilds the scale and all layouts, then draws
function resizeChart() {
  size = { width: chartBox.clientWidth, height: chartBox.clientHeight };
  if (size.width === 0 || size.height === 0) return;
  const margin = getMargins();

  svg.attr("viewBox", `0 0 ${size.width} ${size.height}`);

  // Size the canvas for sharp dots on high-resolution screens
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = size.width * pixelRatio;
  canvas.height = size.height * pixelRatio;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  // Log scale on (days + 1) so same-day stays still have a place to sit
  const maxDays = d3.max(dogs, (dog) => dog.days);
  yScale = d3
    .scaleLog()
    .domain([1, maxDays + 1])
    .range([size.height - margin.bottom, margin.top]);

  dogs.forEach((dog) => (dog.y = yScale(dog.days + 1)));
  currentRadius = dotRadius();
  Object.values(VIEWS).forEach(layoutView);

  // Jump straight to the current view (no slide while resizing)
  if (slideTimer) slideTimer.stop();
  medianOpacity = 1;
  dogs.forEach((dog) => (dog.drawX = dog.x[currentView]));

  drawAxis(margin, maxDays);
  paintDots();
  drawColumns(false);
  writeStat(VIEWS.color, "#stat-color");
  writeStat(VIEWS.age, "#stat-age");
  writeStat(VIEWS.breed, "#stat-breed");
}

function drawAxis(margin, maxDays) {
  visibleTicks = DAY_TICKS.filter((tick) => tick.days <= maxDays);

  gridLayer
    .selectAll("text")
    .data(visibleTicks)
    .join("text")
    .attr("class", "axis-label")
    .attr("x", margin.left - 8)
    .attr("y", (tick) => yScale(tick.days + 1))
    .attr("dy", "0.32em")
    .attr("text-anchor", "end")
    .text((tick) => tick.label);
}

// Paints the grid lines and every dot at its current drawX
function paintDots() {
  const margin = getMargins();
  context.clearRect(0, 0, size.width, size.height);

  context.strokeStyle = "#d9cfbf";
  context.lineWidth = 1;
  context.beginPath();
  visibleTicks.forEach(function (tick) {
    const y = Math.round(yScale(tick.days + 1)) + 0.5;
    context.moveTo(margin.left - 4, y);
    context.lineTo(size.width - margin.right, y);
  });
  context.stroke();

  // Median lines go down first so the dots sit on top of them
  context.globalAlpha = medianOpacity;
  context.strokeStyle = "#2a2520";
  context.lineWidth = 3;
  context.lineCap = "round";
  context.beginPath();
  VIEWS[currentView].groups.forEach(function (group) {
    if (group.count === 0) return;
    const y = yScale(group.median + 1);
    context.moveTo(group.center - group.lineHalfWidth, y);
    context.lineTo(group.center + group.lineHalfWidth, y);
  });
  context.stroke();
  context.globalAlpha = 1;
  context.lineCap = "butt";

  // One path per coat color, so the fill style only changes eight times
  context.strokeStyle = "rgba(42, 37, 32, 0.55)";
  context.lineWidth = Math.min(0.6, currentRadius * 0.35);
  COAT_GROUPS.forEach(function (group) {
    context.beginPath();
    group.dogs.forEach(function (dog) {
      context.moveTo(dog.drawX + currentRadius, dog.y);
      context.arc(dog.drawX, dog.y, currentRadius, 0, Math.PI * 2);
    });
    context.fillStyle = group.fill;
    context.fill();
    context.stroke();
  });

  if (hoveredDog) {
    context.beginPath();
    context.arc(hoveredDog.drawX, hoveredDog.y, currentRadius + 3, 0, Math.PI * 2);
    context.strokeStyle = "#b5532a";
    context.lineWidth = 2.5;
    context.stroke();
  }
}

// Column labels and median marks for the current view
function drawColumns(animate) {
  const view = VIEWS[currentView];
  const margin = getMargins();
  const baseline = size.height - margin.bottom;
  const tilted = view.groups[0].halfWidth < 38;
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

  // (the median line itself is painted on the canvas, underneath the dots)
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

// Slides every dot sideways to its column in the new view. y is not touched.
function showView(viewKey) {
  if (viewKey === currentView || !VIEWS[viewKey]) return;
  currentView = viewKey;
  hideTooltip();
  if (size.width === 0) return; // nothing drawn yet; resizeChart() will use currentView

  const duration = reduceMotion ? 0 : 1100;
  const longestDelay = 400;
  dogs.forEach((dog) => (dog.slideFrom = dog.drawX));

  if (slideTimer) slideTimer.stop();
  slideTimer = d3.timer(function (elapsed) {
    dogs.forEach(function (dog) {
      let progress = duration === 0 ? 1 : (elapsed - dog.slideDelay) / duration;
      progress = Math.min(1, Math.max(0, progress));
      dog.drawX =
        progress === 1 ? dog.x[viewKey] : dog.slideFrom + (dog.x[viewKey] - dog.slideFrom) * d3.easeCubicInOut(progress);
    });
    medianOpacity = Math.min(1, elapsed / (duration + longestDelay));
    paintDots();
    if (elapsed >= duration + longestDelay) slideTimer.stop();
  });

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

// Finds the dot closest to the pointer and shows its details
function handlePointerMove(event) {
  const box = chartBox.getBoundingClientRect();
  const pointerX = event.clientX - box.left;
  const pointerY = event.clientY - box.top;
  const distance = (dog) => (dog.drawX - pointerX) ** 2 + (dog.y - pointerY) ** 2;

  const nearest = d3.least(dogs, distance);
  const reach = currentRadius + 6;
  if (nearest && distance(nearest) <= reach * reach) {
    if (nearest !== hoveredDog) showTooltip(nearest);
  } else {
    hideTooltip();
  }
}

function showTooltip(dog) {
  hoveredDog = dog;
  paintDots();

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
  const left = Math.min(Math.max(dog.drawX - tooltip.offsetWidth / 2, 4), size.width - tooltip.offsetWidth - 4);
  const above = dog.y - tooltip.offsetHeight - 12;
  tooltip.style.left = left + "px";
  tooltip.style.top = (above < 0 ? dog.y + 14 : above) + "px";
}

function hideTooltip() {
  if (!hoveredDog) return;
  hoveredDog = null;
  tooltip.hidden = true;
  if (size.width > 0) paintDots();
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

  // Each coat group keeps its own list of dogs so they can be painted together
  COAT_GROUPS.forEach((group) => (group.dogs = dogs.filter((dog) => dog.coatGroup === group.key)));

  drawLegend();
  document.querySelector("#dog-count").textContent = dogs.length.toLocaleString("en-US");
  // The observer fires once right away, and again whenever the chart box changes size
  new ResizeObserver(resizeChart).observe(chartBox);
  updateActiveStep();
  window.addEventListener("scroll", updateActiveStep, { passive: true });
  chartBox.addEventListener("pointermove", handlePointerMove);
  chartBox.addEventListener("pointerleave", hideTooltip);
}

start();
