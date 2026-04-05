// Maps Revit internal BuiltInCategory names to user-friendly display labels
const CATEGORY_DISPLAY_NAMES = {
    'OST_DuctCurves':          'Ducts',
    'OST_PipeCurves':          'Pipes',
    'OST_Walls':               'Walls',
    'OST_Floors':              'Floors',
    'OST_StructuralColumns':   'Structural Columns',
    'OST_StructuralFraming':   'Structural Framing',
    'OST_CableTray':           'Cable Trays',
    'OST_Conduit':             'Conduit',
    'OST_MechanicalEquipment': 'Mechanical Equipment',
    'OST_PlumbingFixtures':    'Plumbing Fixtures',
};
function categoryLabel(ost) {
    return CATEGORY_DISPLAY_NAMES[ost] || ost.replace('OST_', '');
}

let currentSelectionIds = [];
let ruleSets = []; // Stores the rule configuration
let warningsTreemap; // Chart.js instance for treemap
let duplicatesChart; // Chart.js instance for duplicates
let clashChart; // Chart.js instance for clash detection
let ruleChartsMap = {}; // Tracks Chart.js instances for rules

// Rule Builder State
let rbState = {
    view: 'sets', // 'sets', 'rules', 'builder'
    activeSetIndex: -1,
    activeRuleIndex: -1,
    availableCategories: [],
    availableParameters: [],
    availableParameterValues: []
};

// Clash Selection States
let hostClashCategories = [];
let hostClashSelection = null;   // single string
let availableLinkedModels = [];
let selectedLinkedModelId = null;
let linkClashCategories = [];
let linkClashSelection = null;   // single string
let clashTests = []; // Array of { id, hostCat, linkInstanceId, linkInstanceName, linkCat }

// Analytics State
let analyticsCharts = []; // [{id, def, chartInstance}]
let analyticsChartIdCounter = 0;
let analyticsBuilderState = {}; // current chart being built
let analyticsAvailableCategories = [];
let analyticsAvailableParameters = [];
let analyticsGroupByParameters = [];

const moonIcon = `<svg viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-3.03 0-5.5-2.47-5.5-5.5 0-1.82.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>`;
const sunIcon = `<svg viewBox="0 0 24 24"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0s-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41s-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41s-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"/></svg>`;

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initTabs();
    initCharts();
    initAnalytics();

    // Listen for messages from host (C#)
    window.chrome.webview.addEventListener('message', event => {
        console.log("QM Message Received:", event.data);
        let message;
        try {
            message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        } catch (e) {
            console.error("Failed to parse QM message:", e);
            return;
        }

        if (message.type === 'updateData') {
            updateDashboard(message.payload);
        } else if (message.type === 'ruleSettings') {
            ruleSets = message.payload || [];
            renderRuleModalContainer();
        } else if (message.type === 'clashCategories') {
            rbState.availableCategories = message.payload || [];
            populateClashCategories(rbState.availableCategories);
        } else if (message.type === 'clashRunning') {
            showClashProgress(message.payload.total);
        } else if (message.type === 'clashProgress') {
            updateClashProgress(message.payload.processed, message.payload.total);
        } else if (message.type === 'clashResults') {
            hideClashProgress();
            renderClashResults(message.payload);
        } else if (message.type === 'ruleParameters') {
            rbState.availableParameters = message.payload || [];
            if (rbState.view === 'builder') renderRuleModalContainer();
        } else if (message.type === 'ruleParameterValues') {
            rbState.availableParameterValues = message.payload || [];
            if (rbState.view === 'builder') renderRuleModalContainer();
        } else if (message.type === 'linkedModels') {
            populateLinkedModels(message.payload || []);
        } else if (message.type === 'hostCategories') {
            populateHostCategories(message.payload || []);
        } else if (message.type === 'linkCategories') {
            populateLinkCategories(message.payload || []);
        } else if (message.type === 'analyticsParameters') {
            analyticsAvailableParameters = message.payload || [];
            onAnalyticsParametersReceived(message.chartId);
        } else if (message.type === 'analyticsResult') {
            renderAnalyticsChart(message.payload);
        } else if (message.type === 'clashConfigsLoaded') {
            // H2: Handle imported clash test configurations
            try {
                const imported = JSON.parse(message.payload);
                if (Array.isArray(imported)) {
                    clashTests = imported;
                    renderClashTests();
                }
            } catch(e) { console.error('Failed to parse imported clash configs:', e); }
        } else if (message.type === 'ruleCheckResults') {
            // M6: Rule check results arrive separately from the overview refresh
            renderRuleResultsOverview(message.payload);
        } else if (message.type === 'systemError') {
            showErrorDialog(message.payload);
        }
    });

    // Single delegated listener to close custom dropdown panels when clicking outside
    document.addEventListener('click', (e) => {
        document.querySelectorAll('.custom-dropdown-panel').forEach(panel => {
            const wrapper = panel.closest('.custom-dropdown-wrapper');
            if (wrapper && !wrapper.contains(e.target)) {
                panel.style.display = 'none';
            }
        });
    });

    // Request initial data when webview is ready
    if (window.chrome && window.chrome.webview) {
        sendMessage('getRules');
        // Linked models and host categories are fetched when clash tab is opened
    }

    // Request initial data
    document.getElementById('refresh-btn').addEventListener('click', () => {
        runAnalysis();
        // Reset selection
        currentSelectionIds = [];
        document.querySelectorAll('.isolate-btn').forEach(b => b.disabled = true);
    });

    // Isolate Button
    document.querySelectorAll('.isolate-btn').forEach(btn => btn.addEventListener('click', () => {
        if (currentSelectionIds.length > 0) {
            isolateElements(currentSelectionIds);
        }
    }));

    // Reset View Button
    document.querySelectorAll('.reset-view-btn').forEach(btn => btn.addEventListener('click', () => {
        resetView();
        // Remove selections from UI visually
        document.querySelectorAll('.tm-node').forEach(n => n.classList.remove('selected'));
        document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('selected'));
        currentSelectionIds = [];
        document.querySelectorAll('.isolate-btn').forEach(b => b.disabled = true);
    }));

    // Rule Modal Events
    const ruleModal = document.getElementById('rule-modal');
    document.getElementById('rule-settings-btn').addEventListener('click', () => {
        rbState.view = 'sets';
        rbState.activeSetIndex = -1;
        rbState.activeRuleIndex = -1;
        ruleModal.classList.add('active');
        renderRuleModalContainer();
    });

    document.getElementById('close-modal-btn').addEventListener('click', () => {
        ruleModal.classList.remove('active');
    });

    // The 'save-rules-btn' in modal-footer saves everything
    document.getElementById('save-rules-btn').addEventListener('click', () => {
        sendMessage('saveRules', ruleSets);
        runAnalysis(); // Refresh overview stats
        sendMessage('runRuleChecks'); // M6: Re-evaluate rule checks with updated rules
        ruleModal.classList.remove('active');
    });

    const cancelBtn = document.getElementById('cancel-modal-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
        ruleModal.classList.remove('active');
        sendMessage('getRules');
    });

    const exportBtn = document.getElementById('export-rules-btn');
    if (exportBtn) exportBtn.addEventListener('click', () => {
        sendMessage('exportRules', ruleSets);
    });

    const importBtn = document.getElementById('import-rules-btn');
    if (importBtn) importBtn.addEventListener('click', () => {
        sendMessage('importRules');
    });

    document.getElementById('back-to-rules-btn').addEventListener('click', () => {
        document.getElementById('rules-detail-container').style.display = 'none';
        document.getElementById('rules-overview-container').style.display = 'flex';
    });

    // Clash Detection Events — show running state immediately on click
    document.getElementById('run-clash-btn').addEventListener('click', () => {
        if (clashTests.length === 0) {
            alert('Please add at least one clash test first.');
            return;
        }
        sendMessage('runClash', { tests: clashTests });
    });

    // Add Clash Test Button
    document.getElementById('add-clash-test-btn').addEventListener('click', () => {
        if (!hostClashSelection) {
            alert('Please select a Host Category.');
            return;
        }
        if (!selectedLinkedModelId) {
            alert('Please select a Linked Model.');
            return;
        }
        if (!linkClashSelection) {
            alert('Please select a Link Category.');
            return;
        }

        const linkModelSelect = document.getElementById('link-model-select');
        const linkName = linkModelSelect.options[linkModelSelect.selectedIndex].text;

        clashTests.push({
            id: crypto.randomUUID(),
            hostCat: hostClashSelection,
            linkInstanceId: selectedLinkedModelId,
            linkInstanceName: linkName,
            linkCat: linkClashSelection
        });

        renderClashTests();
    });

    // Import/Export Clash Config
    document.getElementById('export-clash-btn').addEventListener('click', () => {
        sendMessage('exportClashConfigs', clashTests);
    });

    document.getElementById('import-clash-btn').addEventListener('click', () => {
        sendMessage('importClashConfigs');
    });

    // Link Model Selection Change
    document.getElementById('link-model-select').addEventListener('change', (e) => {
        const linkId = e.target.value;
        selectedLinkedModelId = linkId || null;
        linkClashSelection = null;
        if (!linkId) {
            createSingleSelectDropdown('link-cat-container', 'Select a linked model first...', []);
            return;
        }
        // Request categories for this specific linked model
        sendMessage('getLinkCategories', { linkInstanceId: linkId });
    });

    // Clash tab: refresh links button
    document.getElementById('refresh-links-btn').addEventListener('click', () => {
        sendMessage('getLinkedModels');
        sendMessage('getHostCategories');
    });

    // Theme Toggle via Button
    const themeToggle = document.getElementById('theme-toggle');
    themeToggle.addEventListener('click', () => {
        const isLight = document.body.classList.toggle('light-mode');
        themeToggle.innerHTML = isLight ? moonIcon : sunIcon;
        localStorage.setItem('theme', isLight ? 'light' : 'dark');

        // Update Chart JS colors
        if (duplicatesChart) {
            duplicatesChart.options.scales.x.ticks.color = isLight ? '#6b7280' : '#bbb';
            duplicatesChart.options.scales.y.ticks.color = isLight ? '#6b7280' : '#bbb';
            duplicatesChart.options.scales.y.grid.color = isLight ? '#e5e7eb' : '#444';
            duplicatesChart.update();
        }
    });
});

// Helper to send messages to C# backend
const sendMessage = (action, payload = null) => {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify({ action, payload }));
    }
};

function runAnalysis() {
    sendMessage('refresh');
}

function isolateElements(elementIds) {
    sendMessage('isolate', elementIds);
}

function resetView() {
    sendMessage('reset');
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const themeToggle = document.getElementById('theme-toggle');
    
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
        themeToggle.innerHTML = moonIcon;
    } else {
        document.body.classList.remove('light-mode');
        themeToggle.innerHTML = sunIcon;
    }
}

function initCharts() {
    // Duplicates Bar Chart
    const ctxDuplicates = document.getElementById('duplicatesChart').getContext('2d');
    const isLight = document.body.classList.contains('light-mode');

    duplicatesChart = new Chart(ctxDuplicates, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Duplicate Count',
                data: [],
                backgroundColor: '#f43f5e', // Vibrant Rose
                borderRadius: 6,
                borderWidth: 0,
                barThickness: 20
            }]
        },
        options: {
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: isLight ? '#e5e7eb' : '#444' },
                    ticks: { color: isLight ? '#6b7280' : '#bbb' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: isLight ? '#6b7280' : '#bbb' }
                }
            },
            plugins: {
                legend: { display: false }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const idsList = document.getElementById('duplicatesChart').duplicateIdsList;
                    if (idsList && idsList[idx] && idsList[idx].length > 0) {
                        // clear other selections
                        document.querySelectorAll('.tm-node').forEach(n => n.classList.remove('selected'));
                        document.querySelectorAll('.stat-card').forEach(n => n.classList.remove('selected'));

                        currentSelectionIds = idsList[idx];
                        document.querySelectorAll('.isolate-btn').forEach(b => b.disabled = false);
                    }
                }
            }
        }
    });
}

function updateDashboard(stats) {
    if (!stats) return;

    // Update Stats (PascalCase from C#)
    document.getElementById('file-size').textContent = Math.round(stats.FileSizeMB * 10) / 10 + ' MB';
    document.getElementById('cad-imports').textContent = `${stats.CadImportsCount} Imp / ${stats.CadLinksCount} Lnks`;
    document.getElementById('inplace-families').textContent = stats.InPlaceFamiliesCount;
    document.getElementById('untemplated-views').textContent = stats.UntemplatedViewsCount;
    document.getElementById('purgeable-elements').textContent = stats.PurgeableCount;
    document.getElementById('generic-models').textContent = stats.GenericModelsCount;
    document.getElementById('unpinned-links').textContent = stats.UnpinnedLinksCount;
    document.getElementById('groups-count').textContent = stats.GroupsCount;

    // Build Custom DOM Tree Map
    renderWarningsTreemap(stats.Warnings);

    // Rule check results are fetched independently via 'runRuleChecks' (M6) and
    // handled by the 'ruleCheckResults' message handler to avoid blocking overview refresh.

    // Add interactivity to specific stat cards
    bindStatCardInteractivity('generic-models', stats.GenericModelIds);
    bindStatCardInteractivity('inplace-families', stats.InPlaceFamilyIds);
    bindStatCardInteractivity('groups-count', stats.GroupIds);

    // Update Duplicates Chart
    const labels = Object.keys(stats.DuplicatesByCategory);
    const values = Object.values(stats.DuplicatesByCategory).map(v => v.Count);
    const totalDuplicates = values.reduce((a, b) => a + b, 0);

    const totalDuplicatesEl = document.getElementById('total-duplicates-count');
    if (totalDuplicatesEl) totalDuplicatesEl.textContent = totalDuplicates.toLocaleString();

    // Store associated ElementIds on the canvas for lookup in onClick
    const duplicateIdsList = Object.values(stats.DuplicatesByCategory).map(v => v.ElementIds);
    document.getElementById('duplicatesChart').duplicateIdsList = duplicateIdsList;

    duplicatesChart.data.labels = labels;
    duplicatesChart.data.datasets[0].data = values;
    duplicatesChart.update();
}

function bindStatCardInteractivity(elementIdStr, idsList) {
    const pTag = document.getElementById(elementIdStr);
    if (!pTag) return;

    const card = pTag.closest('.stat-card');
    if (!card) return;

    if (idsList && idsList.length > 0) {
        card.classList.add('selectable');
        card.onclick = () => {
            // Visual selection
            document.querySelectorAll('.tm-node').forEach(n => n.classList.remove('selected'));
            document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');

            currentSelectionIds = idsList;
            document.querySelectorAll('.isolate-btn').forEach(b => b.disabled = false);
        };
    } else {
        card.classList.remove('selectable');
        card.onclick = null;
    }
}

function renderWarningsTreemap(warnings) {
    const isLight = document.body.classList.contains('light-mode');
    const canvas = document.getElementById('warningsTreemapCanvas');
    if (!canvas) return;

    if (warningsTreemap) warningsTreemap.destroy();

    if (!warnings || warnings.length === 0) {
        // Show empty message
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle = isLight ? '#64748b' : '#94a3b8';
        ctx.textAlign = 'center';
        ctx.font = '13px "Outfit", sans-serif';
        ctx.fillText('No warnings found in model.', canvas.width/2, canvas.height/2);
        return;
    }

    // Update Header Metrics
    const totalCount = warnings.reduce((sum, w) => sum + w.Count, 0);
    const highImpact = warnings.filter(w => w.Impact === 'High Impact').reduce((s, w) => s + w.Count, 0);
    const amberImpact = warnings.filter(w => w.Impact === 'Low Impact').reduce((s, w) => s + w.Count, 0);
    const noImpact = warnings.filter(w => w.Impact === 'No Impact').reduce((s, w) => s + w.Count, 0);
    const unclassifiedImpact = totalCount - (highImpact + amberImpact + noImpact);

    const totalWarningsEl = document.getElementById('total-warnings-count');
    if (totalWarningsEl) totalWarningsEl.textContent = totalCount.toLocaleString();

    const breakdownEl = document.getElementById('warnings-breakdown-subtext');
    if (breakdownEl) {
        breakdownEl.innerHTML = `
            <div style="display:flex; align-items:center; gap:4px;"><span style="width:6px; height:6px; border-radius:50%; background:#ef4444;"></span> <strong>${highImpact}</strong> High</div>
            <div style="display:flex; align-items:center; gap:4px;"><span style="width:6px; height:6px; border-radius:50%; background:#f59e0b;"></span> <strong>${amberImpact}</strong> Amber</div>
            <div style="display:flex; align-items:center; gap:4px;"><span style="width:6px; height:6px; border-radius:50%; background:#10b981;"></span> <strong>${noImpact}</strong> No</div>
            <div style="display:flex; align-items:center; gap:4px;"><span style="width:6px; height:6px; border-radius:50%; background:#6366f1;"></span> <strong>${unclassifiedImpact}</strong> Other</div>
        `;
    }

    const data = warnings.map(w => ({
        label: w.Description,
        count: w.Count,
        impact: w.Impact && w.Impact !== 'Unclassified' ? w.Impact : 'Other',
        ids: w.ElementIds || []
    }));

    // Lookup map keyed by label — avoids dependence on treemap _data internals
    const warningsByLabel = {};
    data.forEach(w => { warningsByLabel[w.label] = w; });

    // Helper: resolve a treemap node back to our original data object
    const resolveWarning = (raw) => {
        if (!raw) return null;
        // Try _data.label first, then the group key 'g', then _data itself
        const label = raw._data?.label || raw.g || raw._data?.g;
        if (label && warningsByLabel[label]) return warningsByLabel[label];
        // Fallback: if _data has ids directly, use it
        if (raw._data?.ids) return raw._data;
        return null;
    };

    warningsTreemap = new Chart(canvas.getContext('2d'), {
        type: 'treemap',
        data: {
            datasets: [{
                tree: data,
                key: 'count',
                groups: ['impact', 'label'],
                spacing: 2,
                borderWidth: 1,
                borderColor: isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)',
                borderRadius: 4,
                backgroundColor: (ctx) => {
                    const w = resolveWarning(ctx.raw);
                    // For leaf nodes, use resolved impact; for group nodes, raw.g IS the impact string
                    const impact = w ? w.impact : (ctx.raw?.g || '');
                    if (impact === 'High Impact') return '#ef4444';
                    if (impact === 'Low Impact') return '#f59e0b';
                    if (impact === 'No Impact') return '#10b981';
                    return '#6366f1';
                },
                labels: {
                    display: (ctx) => {
                        if (ctx.type !== 'data') return false;
                        const {w, h} = ctx.raw;
                        return w > 60 && h > 40;
                    },
                    formatter: (ctx) => {
                        if (ctx.type === 'data') {
                            const w = resolveWarning(ctx.raw);
                            const label = w?.label || '';
                            const count = w?.count || '';

                            const maxWidth = ctx.raw.w - 8;
                            const charWidth = 6;
                            const words = label.split(' ');
                            const lines = [];
                            let currentLine = '';

                            words.forEach(word => {
                                const testLine = currentLine + (currentLine ? ' ' : '') + word;
                                if (testLine.length * charWidth > maxWidth && currentLine) {
                                    lines.push(currentLine);
                                    currentLine = word;
                                } else {
                                    currentLine = testLine;
                                }
                            });
                            if (currentLine) lines.push(currentLine);

                            const result = [...lines, `(${count})`].slice(0, Math.floor(ctx.raw.h / 14));
                            return result;
                        }
                        return '';
                    },
                    color: '#ffffff',
                    font: { size: 10, weight: '600', family: "'Outfit', sans-serif" },
                    padding: 4
                }
            }]
        },
        options: {
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    filter: (tooltipItem) => {
                        // Only show tooltip for leaf nodes (resolved warnings), suppress group nodes
                        return !!resolveWarning(tooltipItem.raw);
                    },
                    callbacks: {
                        title: (items) => {
                            const w = resolveWarning(items[0]?.raw);
                            if (!w) return '';
                            const fullText = w.label || '';

                            const maxLineLength = 50;
                            const words = fullText.split(' ');
                            const result = [];
                            let line = '';

                            words.forEach(word => {
                                if ((line + word).length > maxLineLength) {
                                    result.push(line.trim());
                                    line = word + ' ';
                                } else {
                                    line += word + ' ';
                                }
                            });
                            if (line) result.push(line.trim());
                            return result;
                        },
                        label: () => ''
                    }
                }
            },
            onClick: (evt, elements) => {
                if (elements.length === 0) return;

                // Try every possible path to resolve the warning data
                let warning = null;
                for (const el of elements) {
                    warning = resolveWarning(el.element?.raw)
                           || resolveWarning(el.element?.$context?.raw);
                    if (warning && warning.ids && warning.ids.length > 0) break;
                    warning = null;
                }

                if (warning) {
                    document.querySelectorAll('.stat-card').forEach(n => n.classList.remove('selected'));
                    currentSelectionIds = warning.ids;
                    document.querySelectorAll('.isolate-btn').forEach(b => b.disabled = false);
                }
            }
        }
    });
}




function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');

            // Load clash data when the Clash Detection tab is first opened
            if (btn.dataset.tab === 'tab-rules') {
                sendMessage('getHostCategories');
                sendMessage('runRuleChecks'); // M6: Evaluate rules on tab open
            }
            if (btn.dataset.tab === 'tab-clash') {
                sendMessage('getLinkedModels');
                sendMessage('getHostCategories');
            }
            if (btn.dataset.tab === 'tab-analytics') {
                analyticsAvailableCategories = [];
                sendMessage('getHostCategories');
            }
        });
    });
}

// --- Rule Builder UI Logic ---

function runClash() {
    const tests = clashTests.filter(t => t.isActive !== false);
    if (tests.length === 0) return;

    // Reset results cache if any
    clashResults = null;

    showClashProgress(tests.length);
    sendMessage('runClash', { tests: tests });
}

function cancelClash() {
    sendMessage('cancelClash');
    hideClashProgress();
    renderClashTests(); // Back to list
}

// H3: showClashProgress / updateClashProgress / hideClashProgress were previously defined here
// as dead duplicates with bugs. The live implementations are further down in the file.

function renderRuleModalContainer() {
    const container = document.getElementById('rule-sets-container');
    container.innerHTML = '';
    
    // Grab the add-ruleset button from index.html if it exists so we can hide/show it
    const addRsBtn = document.getElementById('add-ruleset-btn');
    if (addRsBtn) addRsBtn.style.display = 'none'; // hide by default

    const titleEl = document.querySelector('#rule-modal .modal-header h2');

    if (rbState.view === 'sets') {
        titleEl.textContent = 'Rule Settings (Sets)';
        if (addRsBtn) {
            addRsBtn.style.display = 'block';
            addRsBtn.onclick = () => {
                ruleSets.push({
                    Id: crypto.randomUUID(),
                    Name: 'New Rule Set',
                    Description: '',
                    IsActive: true,
                    Rules: []
                });
                renderRuleModalContainer();
            };
        }

        if(ruleSets.length === 0) {
             container.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding: 20px;">No rule sets defined.</p>';
        }

        ruleSets.forEach((rs, index) => {
            const rulesetCard = document.createElement('div');
            rulesetCard.className = 'ruleset-card';
            rulesetCard.style.padding = '12px';
            rulesetCard.style.marginBottom = '8px';
            rulesetCard.style.border = 'none';
            rulesetCard.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            rulesetCard.style.borderRadius = '6px';
            rulesetCard.style.display = 'flex';
            rulesetCard.style.justifyContent = 'space-between';
            rulesetCard.style.alignItems = 'center';
            rulesetCard.style.width = '100%';
            rulesetCard.style.boxSizing = 'border-box';
            rulesetCard.style.backgroundColor = 'var(--card-bg)';

            const leftSide = document.createElement('div');
            leftSide.style.display = 'flex';
            leftSide.style.alignItems = 'center';
            leftSide.style.flex = '1';

            const toggleWrapper = document.createElement('label');
            toggleWrapper.style.display = 'flex';
            toggleWrapper.style.alignItems = 'center';
            toggleWrapper.style.marginRight = '12px';
            toggleWrapper.style.cursor = 'pointer';

            const toggleCb = document.createElement('input');
            toggleCb.type = 'checkbox';
            toggleCb.checked = rs.IsActive !== false;
            toggleCb.style.width = '16px';
            toggleCb.style.height = '16px';
            toggleCb.style.accentColor = 'var(--accent)';
            toggleCb.style.cursor = 'pointer';

            toggleCb.onchange = (e) => {
                rs.IsActive = e.target.checked;
            };
            
            toggleWrapper.appendChild(toggleCb);

            const nameContainer = document.createElement('div');
            nameContainer.style.flex = '1';
            nameContainer.style.display = 'flex';
            nameContainer.style.alignItems = 'center';
            nameContainer.style.marginRight = '12px';

            let isEditingName = false;

            const nameSpan = document.createElement('span');
            nameSpan.textContent = rs.Name || 'Unnamed Rule Set';
            nameSpan.style.fontWeight = '500';
            nameSpan.style.flex = '1';

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.value = rs.Name || '';
            nameInput.style.flex = '1';
            nameInput.style.display = 'none';

            const editNameBtn = document.createElement('button');
            editNameBtn.className = 'icon-btn';
            editNameBtn.innerHTML = '✎';
            editNameBtn.style.marginLeft = '8px';
            editNameBtn.style.padding = '4px 8px';
            editNameBtn.style.color = 'var(--text-primary)';

            editNameBtn.onclick = () => {
                isEditingName = !isEditingName;
                if (isEditingName) {
                    nameSpan.style.display = 'none';
                    nameInput.style.display = 'block';
                    nameInput.focus();
                    editNameBtn.innerHTML = '✔';
                    editNameBtn.style.color = '#10b981';
                } else {
                    rs.Name = nameInput.value;
                    nameSpan.textContent = rs.Name || 'Unnamed Rule Set';
                    nameInput.style.display = 'none';
                    nameSpan.style.display = 'block';
                    editNameBtn.innerHTML = '✎';
                    editNameBtn.style.color = 'var(--text-secondary)';
                }
            };

            nameInput.onblur = () => {
                if (isEditingName) editNameBtn.click();
            };
            nameInput.onkeydown = (e) => {
                if(e.key === 'Enter') editNameBtn.click();
            };

            nameContainer.appendChild(nameSpan);
            nameContainer.appendChild(nameInput);
            nameContainer.appendChild(editNameBtn);
            
            leftSide.appendChild(toggleWrapper);
            leftSide.appendChild(nameContainer);

            const actionsDiv = document.createElement('div');
            actionsDiv.style.display = 'flex';
            actionsDiv.style.gap = '8px';

            const editRulesBtn = document.createElement('button');
            editRulesBtn.className = 'secondary-btn';
            editRulesBtn.textContent = `Edit Rules (${rs.Rules ? rs.Rules.length : 0})`;
            editRulesBtn.onclick = () => {
                rbState.activeSetIndex = index;
                rbState.view = 'rules';
                renderRuleModalContainer();
            };

            const delBtn = document.createElement('button');
            delBtn.className = 'icon-btn';
            delBtn.style.color = '#ef4444';
            delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
            delBtn.onclick = () => {
                ruleSets.splice(index, 1);
                renderRuleModalContainer();
            };

            actionsDiv.appendChild(editRulesBtn);
            actionsDiv.appendChild(delBtn);

            rulesetCard.appendChild(leftSide);
            rulesetCard.appendChild(actionsDiv);
            container.appendChild(rulesetCard);
        });
    } 
    else if (rbState.view === 'rules') {
        const rs = ruleSets[rbState.activeSetIndex];
        titleEl.textContent = `Rules in: ${rs.Name || 'Unnamed Set'}`;

        const backBtn = document.createElement('button');
        backBtn.className = 'secondary-btn';
        backBtn.textContent = '← Back to Sets';
        backBtn.style.marginBottom = '12px';
        backBtn.onclick = () => {
            rbState.view = 'sets';
            renderRuleModalContainer();
        };
        container.appendChild(backBtn);

        if (!rs.Rules) rs.Rules = [];
        if (rs.Rules.length === 0) {
            container.insertAdjacentHTML('beforeend', '<p style="color:var(--text-secondary); text-align:center; padding: 10px;">No rules in this set.</p>');
        }

        rs.Rules.forEach((rule, rIndex) => {
            const ruleCard = document.createElement('div');
            ruleCard.style.padding = '12px';
            ruleCard.style.marginBottom = '8px';
            ruleCard.style.border = '1px solid var(--border-color)';
            ruleCard.style.borderRadius = '6px';
            ruleCard.style.display = 'flex';
            ruleCard.style.justifyContent = 'space-between';
            ruleCard.style.alignItems = 'center';

            ruleCard.style.width = '100%';
            ruleCard.style.boxSizing = 'border-box';
            ruleCard.style.backgroundColor = 'var(--card-bg)';

            const leftSide = document.createElement('div');
            leftSide.style.display = 'flex';
            leftSide.style.alignItems = 'center';
            leftSide.style.flex = '1';

            const toggleWrapper = document.createElement('label');
            toggleWrapper.style.display = 'flex';
            toggleWrapper.style.alignItems = 'center';
            toggleWrapper.style.marginRight = '12px';
            toggleWrapper.style.cursor = 'pointer';

            const toggleCb = document.createElement('input');
            toggleCb.type = 'checkbox';
            toggleCb.checked = rule.IsActive !== false;
            toggleCb.style.width = '16px';
            toggleCb.style.height = '16px';
            toggleCb.style.accentColor = 'var(--accent)';
            toggleCb.style.cursor = 'pointer';

            toggleCb.onchange = (e) => {
                rule.IsActive = e.target.checked;
            };
            
            toggleWrapper.appendChild(toggleCb);

            const ruleNameSpan = document.createElement('span');
            ruleNameSpan.textContent = rule.Name || 'Unnamed Rule';
            ruleNameSpan.style.flex = '1';
            
            leftSide.appendChild(toggleWrapper);
            leftSide.appendChild(ruleNameSpan);

            const actionsDiv = document.createElement('div');
            actionsDiv.style.display = 'flex';
            actionsDiv.style.gap = '8px';

            const editBtn = document.createElement('button');
            editBtn.className = 'secondary-btn';
            editBtn.textContent = 'Configure';
            editBtn.onclick = () => {
                rbState.activeRuleIndex = rIndex;
                rbState.view = 'builder';
                // Trigger fetch for parameters based on this rule's filters
                fetchParametersForActiveRule();
                renderRuleModalContainer();
            };

            const delBtn = document.createElement('button');
            delBtn.className = 'icon-btn';
            delBtn.style.color = '#ef4444';
            delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
            delBtn.onclick = () => {
                rs.Rules.splice(rIndex, 1);
                renderRuleModalContainer();
            };

            actionsDiv.appendChild(editBtn);
            actionsDiv.appendChild(delBtn);

            ruleCard.appendChild(leftSide);
            ruleCard.appendChild(actionsDiv);
            container.appendChild(ruleCard);
        });

        const addRuleBtn = document.createElement('button');
        addRuleBtn.className = 'secondary-btn full-width';
        addRuleBtn.style.marginTop = '12px';
        addRuleBtn.style.borderStyle = 'dashed';
        addRuleBtn.textContent = '+ Add New Rule';
        addRuleBtn.onclick = () => {
            rs.Rules.push({
                Id: crypto.randomUUID(),
                Name: 'Rule ' + (rs.Rules.length + 1),
                IsActive: true,
                Filters: [],
                Conditions: []
            });
            renderRuleModalContainer();
        };
        container.appendChild(addRuleBtn);
    } 
    else if (rbState.view === 'builder') {
        const rs = ruleSets[rbState.activeSetIndex];
        const rule = rs.Rules[rbState.activeRuleIndex];

        titleEl.textContent = `Builder: ${rule.Name || 'Unnamed Rule'}`;

        const headerRow = document.createElement('div');
        headerRow.style.display = 'flex';
        headerRow.style.gap = '10px';
        headerRow.style.marginBottom = '12px';

        const backBtn = document.createElement('button');
        backBtn.className = 'secondary-btn';
        backBtn.textContent = '← Back';
        backBtn.onclick = () => {
            rbState.view = 'rules';
            rbState.activeRuleBuilderTab = 'filters'; 
            renderRuleModalContainer();
        };

        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.value = rule.Name || '';
        titleInput.placeholder = 'Rule Title';
        titleInput.style.flex = '1';
        titleInput.onchange = (e) => rule.Name = e.target.value;

        headerRow.appendChild(backBtn);
        headerRow.appendChild(titleInput);
        container.appendChild(headerRow);

        // Nested Tabs for Builder
        if (!rbState.activeRuleBuilderTab) rbState.activeRuleBuilderTab = 'filters';
        
        const tabsDiv = document.createElement('div');
        tabsDiv.className = 'tab-navigation';
        tabsDiv.style.marginBottom = '12px';

        const filterTab = document.createElement('button');
        filterTab.className = 'tab-btn' + (rbState.activeRuleBuilderTab === 'filters' ? ' active' : '');
        filterTab.textContent = 'Filters';
        filterTab.onclick = () => { rbState.activeRuleBuilderTab = 'filters'; renderRuleModalContainer(); };

        const condTab = document.createElement('button');
        condTab.className = 'tab-btn' + (rbState.activeRuleBuilderTab === 'conditions' ? ' active' : '');
        condTab.textContent = 'Conditions';
        condTab.onclick = () => { rbState.activeRuleBuilderTab = 'conditions'; fetchParametersForActiveRule(); renderRuleModalContainer(); };

        tabsDiv.appendChild(filterTab);
        tabsDiv.appendChild(condTab);
        container.appendChild(tabsDiv);

        const contentDiv = document.createElement('div');
        contentDiv.style.padding = '10px';
        contentDiv.style.border = '1px solid var(--border-color)';
        contentDiv.style.borderRadius = '6px';
        
        if (rbState.activeRuleBuilderTab === 'filters') {
            contentDiv.innerHTML = '<p style="font-size:12px; margin-top:0;">Select Model Categories to evaluate:</p>';
            
            // Multiple select categories -> Checkboxes
            const catContainer = document.createElement('div');
            catContainer.style.width = '100%';
            catContainer.style.height = '150px';
            catContainer.style.padding = '8px';
            catContainer.style.backgroundColor = 'var(--bg-color)';
            catContainer.style.border = '1px solid var(--border-color)';
            catContainer.style.borderRadius = '4px';
            catContainer.style.overflowY = 'auto';
            catContainer.style.display = 'flex';
            catContainer.style.flexDirection = 'column';
            catContainer.style.gap = '4px';

            (rbState.availableCategories || []).forEach(cat => {
                const lbl = document.createElement('label');
                lbl.style.display = 'flex';
                lbl.style.alignItems = 'center';
                lbl.style.gap = '8px';
                lbl.style.fontSize = '14px';
                lbl.style.cursor = 'pointer';

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = cat;
                if (rule.Filters && rule.Filters.find(f => f.Category === cat)) {
                    cb.checked = true;
                }

                cb.onchange = () => {
                    const checkboxes = catContainer.querySelectorAll('input[type="checkbox"]:checked');
                    rule.Filters = Array.from(checkboxes).map(c => ({ Category: c.value }));
                };

                lbl.appendChild(cb);
                lbl.appendChild(document.createTextNode(cat));
                catContainer.appendChild(lbl);
            });

            contentDiv.appendChild(catContainer);
        } else {
            // Conditions Tab
            if (!rule.Conditions) rule.Conditions = [];
            
            if (rule.Conditions.length === 0) {
                contentDiv.insertAdjacentHTML('beforeend', '<p style="color:var(--text-secondary); font-size:12px;">No conditions defined. Click below to add.</p>');
            }

            rule.Conditions.forEach((cond, cIndex) => {
                const condRow = document.createElement('div');
                condRow.style.display = 'flex';
                condRow.style.gap = '8px';
                condRow.style.marginBottom = '8px';
                condRow.style.alignItems = 'center';

                // Logical Link
                if (cIndex > 0) {
                    const linkSelect = document.createElement('select');
                    linkSelect.style.width = '70px';
                    ['AND', 'OR'].forEach(lnk => {
                        const opt = document.createElement('option');
                        opt.value = lnk;
                        opt.textContent = lnk;
                        if (cond.LogicalLink === lnk) opt.selected = true;
                        linkSelect.appendChild(opt);
                    });
                    linkSelect.onchange = (e) => cond.LogicalLink = e.target.value;
                    condRow.appendChild(linkSelect);
                } else {
                    const placeHolder = document.createElement('div');
                    placeHolder.style.width = '70px';
                    placeHolder.style.textAlign = 'center';
                    placeHolder.style.fontSize = '12px';
                    placeHolder.style.color = 'var(--text-secondary)';
                    placeHolder.textContent = 'IF';
                    condRow.appendChild(placeHolder);
                }

                // Parameter Select
                const paramSelect = document.createElement('select');
                paramSelect.className = 'flex-1';
                paramSelect.style.flex = '1';
                paramSelect.innerHTML = '<option value="">-- Select Parameter --</option>';
                // If it's selected but not in the fetched list yet, add it anyway to avoid destroying data
                let paramFound = false;
                (rbState.availableParameters || []).forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p;
                    opt.textContent = p;
                    if (cond.ParameterName === p) {
                        opt.selected = true;
                        paramFound = true;
                    }
                    paramSelect.appendChild(opt);
                });
                if (cond.ParameterName && !paramFound) {
                    const opt = document.createElement('option');
                    opt.value = cond.ParameterName;
                    opt.textContent = cond.ParameterName;
                    opt.selected = true;
                    paramSelect.appendChild(opt);
                }
                paramSelect.onchange = (e) => {
                    cond.ParameterName = e.target.value;
                    cond.TargetValues = [];
                    rbState.availableParameterValues = [];   // discard stale values so Loading... triggers a fresh fetch
                    renderRuleModalContainer();
                };

                // Operator Select
                const opSelect = document.createElement('select');
                opSelect.className = 'flex-1';
                opSelect.style.flex = '1';
                const ops = ['Exists', 'Equals', 'NotEquals', 'Contains', 'RegexMatch', 'GreaterThan', 'LessThan', 'GreaterThanOrEqual', 'LessThanOrEqual'];
                ops.forEach(op => {
                    const opt = document.createElement('option');
                    opt.value = op;
                    opt.textContent = op;
                    if (cond.Operator === op) opt.selected = true;
                    opSelect.appendChild(opt);
                });
                opSelect.onchange = (e) => {
                    cond.Operator = e.target.value;
                    renderRuleModalContainer();
                };

                // Value Input (Depends on Operator)
                let valInput;
                if (cond.Operator === 'Exists') {
                    valInput = document.createElement('span');
                    valInput.className = 'flex-2';
                    valInput.style.flex = '2';
                    valInput.textContent = '-'; // no value needed
                } 
                else if ((cond.Operator === 'Equals' || cond.Operator === 'NotEquals' || cond.Operator === 'Contains') && cond.ParameterName) {
                    const dropdownWrapper = document.createElement('div');
                    dropdownWrapper.style.position = 'relative';
                    dropdownWrapper.className = 'flex-2 custom-dropdown-wrapper';
                    dropdownWrapper.style.flex = '2';
                    
                    const triggerBtn = document.createElement('button');
                    triggerBtn.type = 'button';
                    triggerBtn.style.width = '100%';
                    triggerBtn.style.textAlign = 'left';
                    triggerBtn.style.background = 'var(--card-bg)';
                    triggerBtn.style.color = 'var(--text-primary)';
                    triggerBtn.style.border = '1px solid var(--border-color)';
                    triggerBtn.style.padding = '6px 10px';
                    triggerBtn.style.borderRadius = '4px';
                    triggerBtn.style.display = 'flex';
                    triggerBtn.style.justifyContent = 'space-between';
                    triggerBtn.style.alignItems = 'center';
                    triggerBtn.style.boxShadow = 'none';

                    let selectedCount = (cond.TargetValues && cond.TargetValues.length > 0) ? cond.TargetValues.length : 0;
                    triggerBtn.innerHTML = `<span style="text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${selectedCount === 0 ? '-- Select Values --' : selectedCount + ' selected'}</span> <span style="font-size:10px; margin-left:8px;">▼</span>`;
                    
                    const dropdownPanel = document.createElement('div');
                    dropdownPanel.className = 'custom-dropdown-panel';
                    dropdownPanel.style.display = 'none';
                    dropdownPanel.style.position = 'absolute';
                    dropdownPanel.style.top = '100%';
                    dropdownPanel.style.left = '0';
                    dropdownPanel.style.width = '100%';
                    dropdownPanel.style.maxHeight = '240px';
                    dropdownPanel.style.backgroundColor = 'var(--card-bg)';
                    dropdownPanel.style.border = '1px solid var(--border-color)';
                    dropdownPanel.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                    dropdownPanel.style.zIndex = '1000';
                    dropdownPanel.style.flexDirection = 'column';
                    dropdownPanel.style.borderRadius = '4px';
                    dropdownPanel.style.marginTop = '4px';

                    const searchInput = document.createElement('input');
                    searchInput.type = 'text';
                    searchInput.placeholder = 'Search...';
                    searchInput.style.margin = '8px';
                    searchInput.style.padding = '6px';
                    searchInput.style.border = '1px solid var(--border-color)';
                    searchInput.style.borderRadius = '4px';
                    searchInput.style.backgroundColor = 'var(--bg-color)';
                    searchInput.style.color = 'var(--text-primary)';

                    const listContainer = document.createElement('div');
                    listContainer.style.overflowY = 'auto';
                    listContainer.style.flex = '1';
                    listContainer.style.padding = '0 8px 8px 8px';
                    listContainer.style.display = 'flex';
                    listContainer.style.flexDirection = 'column';
                    listContainer.style.gap = '4px';

                    const updateTriggerText = () => {
                        const count = cond.TargetValues ? cond.TargetValues.length : 0;
                        triggerBtn.innerHTML = `<span style="text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${count === 0 ? '-- Select Values --' : count + ' selected'}</span> <span style="font-size:10px; margin-left:8px;">▼</span>`;
                    };

                    triggerBtn.onclick = (e) => {
                        e.stopPropagation();
                        const isCurrentlyVisible = dropdownPanel.style.display === 'flex';
                        document.querySelectorAll('.custom-dropdown-panel').forEach(p => p.style.display = 'none');
                        if (!isCurrentlyVisible) {
                            dropdownPanel.style.display = 'flex';
                            searchInput.focus();
                        }
                    };

                    dropdownPanel.appendChild(searchInput);
                    dropdownPanel.appendChild(listContainer);
                    dropdownWrapper.appendChild(triggerBtn);
                    dropdownWrapper.appendChild(dropdownPanel);

                    if (rbState.availableParameterValues && rbState.availableParameterValues.length > 0) {
                        const vals = rbState.availableParameterValues || [];
                        const renderList = (filterText) => {
                            listContainer.innerHTML = '';
                            const lowerFilter = filterText ? filterText.toLowerCase() : '';
                            vals.forEach(v => {
                                if (lowerFilter && !v.toLowerCase().includes(lowerFilter)) return;

                                const lbl = document.createElement('label');
                                lbl.style.display = 'flex';
                                lbl.style.alignItems = 'center';
                                lbl.style.gap = '6px';
                                lbl.style.fontSize = '12px';
                                lbl.style.cursor = 'pointer';

                                const cb = document.createElement('input');
                                cb.type = 'checkbox';
                                cb.value = v;
                                if (cond.TargetValues && cond.TargetValues.includes(v)) {
                                    cb.checked = true;
                                }
                                
                                cb.onchange = () => {
                                    if (cb.checked) {
                                        if (!cond.TargetValues.includes(v)) cond.TargetValues.push(v);
                                    } else {
                                        cond.TargetValues = cond.TargetValues.filter(tv => tv !== v);
                                    }
                                    updateTriggerText();
                                };

                                lbl.appendChild(cb);
                                lbl.appendChild(document.createTextNode(v));
                                listContainer.appendChild(lbl);
                            });
                        };

                        renderList('');
                        searchInput.oninput = (e) => renderList(e.target.value);
                    } else {
                        listContainer.innerHTML = '<span style="font-size:11px; color:var(--text-secondary); padding:4px;">Loading...</span>';
                        fetchParameterValuesForRule(rule.Filters, cond.ParameterName);
                    }
                    
                    valInput = dropdownWrapper;
                }
                else {
                    // Regular text input for other operators (or fallback)
                    valInput = document.createElement('input');
                    valInput.type = 'text';
                    valInput.className = 'flex-2';
                    valInput.style.flex = '2';
                    valInput.placeholder = 'Value (comma separated if applicable)';
                    valInput.value = (cond.TargetValues && cond.TargetValues.length > 0) ? cond.TargetValues.join(',') : '';
                    valInput.onchange = (e) => {
                        cond.TargetValues = e.target.value ? e.target.value.split(',').map(s => s.trim()) : [];
                    };
                }

                const delBtn = document.createElement('button');
                delBtn.className = 'icon-btn';
                delBtn.innerHTML = '✕';
                delBtn.onclick = () => {
                    rule.Conditions.splice(cIndex, 1);
                    renderRuleModalContainer();
                };

                condRow.appendChild(paramSelect);
                condRow.appendChild(opSelect);
                condRow.appendChild(valInput);
                condRow.appendChild(delBtn);
                contentDiv.appendChild(condRow);
            });

            const addCondBtn = document.createElement('button');
            addCondBtn.className = 'secondary-btn';
            addCondBtn.style.marginTop = '12px';
            addCondBtn.textContent = '+ Add Condition';
            addCondBtn.onclick = () => {
                rule.Conditions.push({
                    Id: crypto.randomUUID(),
                    ParameterName: '',
                    Operator: 'Equals',
                    TargetValues: [],
                    LogicalLink: 'AND'
                });
                renderRuleModalContainer();
            };
            contentDiv.appendChild(addCondBtn);
        }
        container.appendChild(contentDiv);
    }
}

function fetchParametersForActiveRule() {
    if (rbState.view !== 'builder') return;
    const rs = ruleSets[rbState.activeSetIndex];
    const rule = rs.Rules[rbState.activeRuleIndex];
    
    if (rule && rule.Filters && rule.Filters.length > 0) {
        const cats = rule.Filters.map(f => f.Category);
        sendMessage('getParameters', cats);
    }
}

function fetchParameterValuesForRule(filters, paramName) {
    if (!filters || filters.length === 0 || !paramName) return;
    const cats = filters.map(f => f.Category);
    sendMessage('getParameterValues', { categories: cats, parameterName: paramName });
}

function renderRuleResultsOverview(results) {
    const container = document.getElementById('rules-overview-container');
    container.innerHTML = '';
    
    // Cleanup old charts
    Object.values(ruleChartsMap).forEach(c => c.destroy());
    ruleChartsMap = {};

    // Restore view
    document.getElementById('rules-detail-container').style.display = 'none';
    container.style.display = 'grid';
    container.style.gridTemplateColumns = 'repeat(auto-fit, minmax(280px, 1fr))';
    container.style.gap = '16px';

    if (!results || results.length === 0) {
        container.innerHTML = '<div style="padding:20px; color:var(--text-secondary);">No rule checks configured or evaluated. Open Rule Settings to configure.</div>';
        return;
    }

    results.forEach(rs => {
        const card = document.createElement('div');
        card.className = 'rule-set-card';
        
        // Calculate totals
        let totalPass = 0, totalFail = 0;
        rs.RuleResults.forEach(r => {
            totalPass += r.PassedCount;
            totalFail += r.FailedCount;
        });
        const compliance = (totalPass + totalFail) > 0 ? Math.round((totalPass / (totalPass + totalFail)) * 100) : 0;

        card.innerHTML = `
            <div class="card-header" style="margin-bottom:16px;">
                <div style="flex:1;">
                    <h2 style="font-size:16px;">${rs.RuleSetName}</h2>
                    <p style="font-size:11px; color:var(--text-secondary); margin-top:4px;">${rs.TotalElementsEvaluated} elements evaluated</p>
                </div>
                <div class="rule-status-badge ${compliance === 100 ? 'badge-pass' : 'badge-fail'}">
                    ${compliance}% Compliant
                </div>
            </div>
            <div class="chart-container" style="height:180px;">
                <canvas id="canvas-${rs.RuleSetId}"></canvas>
            </div>
        `;
        
        container.appendChild(card);

        // Render Donut
        const canvas = document.getElementById(`canvas-${rs.RuleSetId}`);
        const ctx = canvas.getContext('2d');
        const isLight = document.body.classList.contains('light-mode');
        
        const passColor = '#10b981'; // Vibrant Emerald
        const failColor = '#f43f5e'; // Vibrant Rose

        if (ruleChartsMap[rs.RuleSetId]) ruleChartsMap[rs.RuleSetId].destroy();

        ruleChartsMap[rs.RuleSetId] = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Passed', 'Failed'],
                datasets: [{
                    data: [totalPass, totalFail],
                    backgroundColor: [passColor, failColor],
                    borderWidth: 0,
                    hoverOffset: 8,
                    cutout: '75%'
                }]
            },
            options: {
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                }
            },
            plugins: [{
                id: 'textCenter',
                beforeDraw: function(chart) {
                    var width = chart.width, height = chart.height, ctx = chart.ctx;
                    ctx.restore();
                    ctx.font = "600 24px 'Outfit', sans-serif";
                    ctx.textBaseline = "middle";
                    ctx.textAlign = "center";
                    ctx.fillStyle = isLight ? "#1f2937" : "#f1f5f9";
                    ctx.fillText(compliance + "%", width / 2, height / 2);
                    ctx.save();
                }
            }]
        });
        
        card.onclick = () => showRuleSetDetails(rs);
    });
}

function showRuleSetDetails(rsResult) {
    document.getElementById('rules-overview-container').style.display = 'none';
    const detailContainer = document.getElementById('rules-detail-container');
    detailContainer.style.display = 'block';
    
    document.getElementById('rules-detail-title').textContent = rsResult.RuleSetName;
    
    const grid = document.getElementById('rules-detail-grid');
    grid.innerHTML = '';
    
    if (!rsResult.RuleResults || rsResult.RuleResults.length === 0) {
        grid.innerHTML = '<p style="padding:20px; color:var(--text-secondary);">No rules defined in this set.</p>';
        return;
    }

    rsResult.RuleResults.forEach(r => {
        const statCard = document.createElement('div');
        statCard.className = 'stat-card';
        
        const total = r.PassedCount + r.FailedCount;
        const passPct = total > 0 ? Math.round((r.PassedCount / total) * 100) : 0;

        statCard.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
                <h3 style="margin:0; font-size:13px; max-width:70%; line-height:1.4;">${r.RuleName || 'Unnamed Rule'}</h3>
                <span class="rule-status-badge ${r.FailedCount === 0 ? 'badge-pass' : 'badge-fail'}">
                    ${r.FailedCount === 0 ? 'Clean' : 'Issues'}
                </span>
            </div>
            <div class="metric-container" style="margin-bottom:8px;">
                <span class="metric-value" style="color:${r.FailedCount > 0 ? 'var(--vibrant-rose)' : 'var(--vibrant-emerald)'}">${r.FailedCount > 0 ? r.FailedCount : r.PassedCount}</span>
                <span class="metric-unit">${r.FailedCount > 0 ? 'Issues' : 'Passed'}</span>
            </div>
            <div style="font-size:11px; color:var(--text-secondary); display:flex; justify-content:space-between;">
                <span>Compliance</span>
                <span>${passPct}%</span>
            </div>
            <div class="rule-progress-bar">
                <div class="rule-progress-fill" style="width:${passPct}%; background:var(--vibrant-emerald);"></div>
                <div class="rule-progress-fill" style="width:${100 - passPct}%; background:var(--vibrant-rose);"></div>
            </div>
        `;
        
        // Interactivity if clicking failed elements
        if (r.FailedCount > 0) {
            statCard.classList.add('selectable');
            statCard.onclick = () => {
                document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('selected'));
                statCard.classList.add('selected');
                currentSelectionIds = r.FailedElementIds || [];
                document.querySelectorAll('.isolate-btn').forEach(b => b.disabled = false);
            };
        }
        grid.appendChild(statCard);
    });
}

// --- Clash Detection Logic ---

function populateLinkedModels(models) {
    console.log("Populating linked models:", models);
    availableLinkedModels = models || [];
    const linkModelSelect = document.getElementById('link-model-select');
    if (!linkModelSelect) {
        console.error("link-model-select element not found!");
        return;
    }
    
    linkModelSelect.innerHTML = '<option value="">Select a Linked Model...</option>';
    if (availableLinkedModels.length === 0) {
        console.warn("No linked models provided to populate.");
        const opt = document.createElement('option');
        opt.textContent = "-- No Links Found --";
        opt.disabled = true;
        linkModelSelect.appendChild(opt);
    }

    availableLinkedModels.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.Id || m.id; // Support both casings just in case
        opt.textContent = m.Name || m.name;
        linkModelSelect.appendChild(opt);
    });

    // Initialize the category containers with placeholders
    createSingleSelectDropdown('host-cat-container', 'Loading host categories...', []);
    createSingleSelectDropdown('link-cat-container', 'Select a linked model first...', []);
}

function populateHostCategories(categories) {
    hostClashCategories = categories || [];
    hostClashSelection = null;
    // Also expose to analytics tab and rule builder
    analyticsAvailableCategories = hostClashCategories.map(c => ({ value: c, label: categoryLabel(c) }));
    rbState.availableCategories = hostClashCategories; 
    
    createSingleSelectDropdown('host-cat-container', 'Select host category...', hostClashCategories, (val) => {
        hostClashSelection = val || null;
    });
}

function populateLinkCategories(categories) {
    linkClashCategories = categories || [];
    linkClashSelection = null;
    createSingleSelectDropdown('link-cat-container', 'Select link category...', linkClashCategories, (val) => {
        linkClashSelection = val || null;
    });
}

// Creates a simple single-select <select> inside the given container ID
function createSingleSelectDropdown(containerId, placeholder, options, onChange) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    const sel = document.createElement('select');
    sel.style.cssText = 'width:100%; padding:6px 10px; font-size:13px; border:1px solid var(--border-color); border-radius:4px; background:var(--card-bg); color:var(--text-primary); min-height:33px;';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = placeholder;
    sel.appendChild(defaultOpt);

    options.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = categoryLabel(cat);
        sel.appendChild(opt);
    });

    sel.addEventListener('change', (e) => {
        if (onChange) onChange(e.target.value || null);
    });

    container.appendChild(sel);
}

function renderClashTests() {
    const list = document.getElementById('clash-tests-list');
    list.innerHTML = '';

    if (clashTests.length === 0) {
        list.innerHTML = '<p style="text-align:center; color:var(--text-secondary); font-size:13px; padding:10px; background:var(--bg-color); border-radius:6px; border:1px dashed var(--border-color);">No clash tests configured. Use the form above to add your first test.</p>';
        return;
    }

    clashTests.forEach((test, idx) => {
        const item = document.createElement('div');
        item.className = 'clash-test-card';

        item.innerHTML = `
            <div style="flex: 1;">
                <div style="font-weight:700; font-size:13px; margin-bottom:4px; color:var(--text-primary);">${test.linkInstanceName}</div>
                <div style="display:flex; gap:12px; align-items:center;">
                    <div style="font-size:11px; color:var(--text-secondary);">
                        <span style="font-weight:600; color:var(--vibrant-indigo); text-transform:uppercase; font-size:9px; letter-spacing:0.3px; margin-right:4px;">Host</span>
                        ${categoryLabel(test.hostCat || '')}
                    </div>
                    <div style="width:1px; height:8px; background:var(--border-color);"></div>
                    <div style="font-size:11px; color:var(--text-secondary);">
                        <span style="font-weight:600; color:var(--vibrant-rose); text-transform:uppercase; font-size:9px; letter-spacing:0.3px; margin-right:4px;">Link</span>
                        ${categoryLabel(test.linkCat || '')}
                    </div>
                </div>
            </div>
            <button class="icon-btn" style="color:var(--vibrant-rose); font-size:16px; opacity:0.6;" title="Remove Test">✕</button>
        `;

        item.querySelector('.icon-btn').onclick = (e) => {
            e.stopPropagation();
            clashTests.splice(idx, 1);
            renderClashTests();
        };

        list.appendChild(item);
    });
}

function showClashProgress(total) {
    const card = document.getElementById('clash-results-card');
    card.style.display = 'block';
    card.innerHTML = `
        <div class="clash-progress-card">
            <div class="clash-spinner"></div>
            <h3>Analyzing Coordination...</h3>
            <p>Processing model geometry in background.</p>
            <div class="clash-progress-bg">
                <div id="clash-progress-bar" class="clash-progress-fill" style="width: 0%"></div>
            </div>
            <div id="clash-progress-text" style="font-size: 12px; margin-top: 10px; color: var(--text-body);">Initializing...</div>
            <button onclick="cancelClash()" class="btn btn-secondary" style="margin-top: 20px; font-size: 12px; padding: 6px 16px;">Cancel Analysis</button>
        </div>
    `;

    const btn = document.getElementById('run-clash-btn');
    if (btn) { 
        btn.disabled = true; 
        btn.textContent = 'Running Analysis…';
    }
}

function updateClashProgress(done, total) {
    const bar = document.getElementById('clash-progress-bar');
    const text = document.getElementById('clash-progress-text');
    if (bar && text) {
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        bar.style.width = pct + '%';
        text.innerText = `Processed ${done.toLocaleString()} of ${total.toLocaleString()} elements (${pct}%)`;
    }
}

function hideClashProgress() {
    const btn = document.getElementById('run-clash-btn');
    if (btn) { btn.disabled = false; btn.textContent = 'Run Clash Test'; }
}

function renderClashResults(report) {
    const card = document.getElementById('clash-results-card');
    card.style.display = 'block';
    card.style.padding = '24px';
    card.innerHTML = ''; // clear spinner / old content

    if (!report || report.TotalClashes === 0) {
        card.innerHTML = `
            <div style="padding:40px 20px; text-align:center;">
                <div style="font-size:48px; margin-bottom:16px;">✨</div>
                <h2 style="font-size:20px; font-weight:700; color:var(--text-primary); margin-bottom:8px;">Model is Clean</h2>
                <p style="font-size:13px; color:var(--text-secondary); line-height:1.5;">No geometric intersections were detected for the current configuration. Your model maintains high geometric integrity.</p>
            </div>
        `;
        return;
    }

    // --- Header and Big Metric ---
    const headerRow = document.createElement('div');
    headerRow.className = 'card-header';
    headerRow.style.marginBottom = '24px';
    headerRow.innerHTML = `
        <div style="flex:1;">
            <h2 style="font-size:16px;">Clash Report Summary</h2>
            <div class="metric-container" style="margin-top:8px;">
                <span class="metric-value" style="color:var(--vibrant-rose);">${report.TotalClashes.toLocaleString()}</span>
                <span class="metric-unit">Total Clashes</span>
            </div>
        </div>
        <div style="text-align:right;">
             <span class="rule-status-badge badge-fail">${report.IndividualTestResults ? report.IndividualTestResults.length : 0} Tests Run</span>
             <p style="font-size:11px; color:var(--text-secondary); margin-top:8px;">Detection complete</p>
        </div>
    `;
    card.appendChild(headerRow);

    // --- Bar chart ---
    const chartWrap = document.createElement('div');
    chartWrap.className = 'chart-container';
    chartWrap.style.height = '240px';
    chartWrap.style.marginBottom = '32px';
    const canvas = document.createElement('canvas');
    canvas.id = 'clashChart';
    chartWrap.appendChild(canvas);
    card.appendChild(chartWrap);

    renderClashChart(report, canvas);

    // --- Advanced Reporting Section ---
    const resultsArea = document.createElement('div');
    resultsArea.id = 'clash-results-interactive';
    card.appendChild(resultsArea);

    let currentTestFilter = ''; 
    let currentLevelFilter = ''; 
    let currentPage = 1;
    const itemsPerPage = 50;

    function renderInteractiveReport(forceLoad = false) {
        if (!forceLoad) {
            resultsArea.innerHTML = '';
            
            let allCrashesFlat = [];
            if (report.IndividualTestResults) {
                report.IndividualTestResults.forEach(tr => {
                    if (tr.Clashes) tr.Clashes.forEach(c => allCrashesFlat.push({ ...c, testSource: tr.TestName }));
                });
            }

            const testsSet = new Set(['Select Test...']);
            const levelsSet = new Set(['Select Level...']);
            allCrashesFlat.forEach(c => {
                if (c.testSource) testsSet.add(c.testSource);
                levelsSet.add(c.LevelName || 'No Level');
            });
            const tests = Array.from(testsSet).sort();
            const levels = Array.from(levelsSet).sort();

            const filterRow = document.createElement('div');
            filterRow.style.cssText = 'display:flex; gap:16px; margin-bottom:20px; padding:16px; background:var(--bg-color); border-radius:12px; border:1px solid var(--border-color);';
            
            const testSelect = createFilterDropdown('Select Test to View', tests, currentTestFilter, (val) => { 
                currentTestFilter = val; 
                currentPage = 1; 
            });
            const levelSelect = createFilterDropdown('Select Level to View', levels, currentLevelFilter, (val) => { 
                currentLevelFilter = val; 
                currentPage = 1; 
            });
            
            filterRow.appendChild(testSelect);
            filterRow.appendChild(levelSelect);

            const showBtnWrap = document.createElement('div');
            showBtnWrap.style.display = 'flex';
            showBtnWrap.style.alignItems = 'flex-end';
            const showBtn = document.createElement('button');
            showBtn.className = 'primary-btn';
            showBtn.style.padding = '8px 16px';
            showBtn.style.fontSize = '12px';
            showBtn.innerText = 'Show Detailed Results';
            showBtn.onclick = () => {
                const isTestSelected = currentTestFilter && currentTestFilter !== 'Select Test...';
                const isLevelSelected = currentLevelFilter && currentLevelFilter !== 'Select Level...';

                if (!isTestSelected || !isLevelSelected) {
                    alert('Please select both a Test and a Level first.');
                    return;
                }
                renderInteractiveReport(true);
            };
            showBtnWrap.appendChild(showBtn);
            filterRow.appendChild(showBtnWrap);
            
            resultsArea.appendChild(filterRow);

            const displayArea = document.createElement('div');
            displayArea.id = 'clash-display-area';
            resultsArea.appendChild(displayArea);

            const placeholder = document.createElement('div');
            placeholder.style.cssText = 'padding:60px 20px; text-align:center; border:2px dashed var(--border-color); border-radius:16px; color:var(--text-secondary);';
            placeholder.innerHTML = `
                <div style="font-size:32px; margin-bottom:12px;">📊</div>
                <div style="font-weight:600; font-size:14px;">Results Filtered</div>
                <div style="font-size:12px; margin-top:4px;">Select filters above and click "Show Detailed Results" to view clash details.</div>
            `;
            displayArea.appendChild(placeholder);
        } else {
            const displayArea = document.getElementById('clash-display-area');
            if (!displayArea) return;
            displayArea.innerHTML = '';

            let allCrashesFlat = [];
            if (report.IndividualTestResults) {
                report.IndividualTestResults.forEach(tr => {
                    if (tr.Clashes) tr.Clashes.forEach(c => allCrashesFlat.push({ ...c, testSource: tr.TestName }));
                });
            }

            let filtered = allCrashesFlat.filter(c => 
                c.testSource === currentTestFilter &&
                (c.LevelName || 'No Level') === currentLevelFilter
            );

            renderResultsTable(filtered, displayArea);
        }
    }

    function renderResultsTable(items, targetContainer) {
        const totalPages = Math.ceil(items.length / itemsPerPage) || 1;
        if (currentPage > totalPages) currentPage = totalPages;
        const start = (currentPage - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        const paged = items.slice(start, end);

        const info = document.createElement('div');
        info.style.cssText = 'font-size:11px; color:var(--text-secondary); margin-bottom:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.4px;';
        info.innerText = items.length > 0 ? `Showing ${start + 1}-${Math.min(end, items.length)} of ${items.length} Level Results` : 'No clashes found for this selection.';
        targetContainer.appendChild(info);

        const tableContainer = document.createElement('div');
        tableContainer.style.overflowX = 'auto';
        const table = document.createElement('table');
        table.style.cssText = 'width:100%; border-collapse:collapse; font-size:12px; min-width:600px;';
        table.innerHTML = `
            <thead>
                <tr style="text-align:left; border-bottom:2px solid var(--border-color); color:var(--text-secondary); text-transform:uppercase; font-size:10px; letter-spacing:0.5px;">
                    <th style="padding:12px 8px;">Host Element</th>
                    <th style="padding:12px 8px;">Link Element</th>
                    <th style="padding:12px 8px; text-align:right;">Actions</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');

        paged.forEach(c => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border-color)';
            tr.innerHTML = `
                <td style="padding:12px 8px;">
                    <div style="font-weight:600; color:var(--text-primary);">${c.ElementName1}</div>
                    <div style="font-size:10px; opacity:0.6;">ID: ${c.ElementId1} | ${categoryLabel(c.Category1)}</div>
                </td>
                <td style="padding:12px 8px;">
                    <div style="font-weight:500;">${c.ElementName2}</div>
                    <div style="font-size:10px; opacity:0.6;">Link: ${c.LinkName}</div>
                </td>
                <td style="padding:12px 8px; text-align:right;">
                    <div style="display:flex; justify-content:flex-end; gap:8px;">
                        <button class="icon-btn" onclick="createSectionBox('${c.ElementId1}', '${c.ElementId2}', '${report.IndividualTestResults.find(t => t.TestName === c.testSource)?.LinkInstanceId}')" style="color:var(--vibrant-indigo);" title="Create Section Box in Active 3D View">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><path d="M3 9V5a2 2 0 0 1 2-2h4"/><path d="M15 3h4a2 2 0 0 1 2 2v4"/><path d="M21 15v4a2 2 0 0 1-2 2h-4"/><path d="M9 21H5a2 2 0 0 1-2-2v-4"/></svg>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
        tableContainer.appendChild(table);
        targetContainer.appendChild(tableContainer);

        if (totalPages > 1) {
            const pagination = document.createElement('div');
            pagination.style.cssText = 'display:flex; justify-content:center; align-items:center; gap:20px; margin-top:24px; padding:16px 0; border-top:1px solid var(--border-color);';
            const prev = document.createElement('button');
            prev.className = 'secondary-btn'; prev.innerText = '←'; prev.disabled = currentPage === 1;
            prev.onclick = () => { currentPage--; renderInteractiveReport(); };
            const next = document.createElement('button');
            next.className = 'secondary-btn'; next.innerText = '→'; next.disabled = currentPage === totalPages;
            next.onclick = () => { currentPage++; renderInteractiveReport(); };
            pagination.appendChild(prev); pagination.appendChild(document.createTextNode(`Page ${currentPage} of ${totalPages}`)); pagination.appendChild(next);
            targetContainer.appendChild(pagination);
        }
    }

    renderInteractiveReport();
}

function createFilterDropdown(label, options, current, onUpdate) {
    const wrap = document.createElement('div');
    wrap.style.flex = '1';
    wrap.innerHTML = `<label style="display:block; font-size:10px; font-weight:700; text-transform:uppercase; color:var(--text-secondary); margin-bottom:6px;">${label}</label>`;
    const sel = document.createElement('select');
    sel.style.cssText = 'width:100%; padding:8px 12px; font-size:13px; border:1px solid var(--border-color); border-radius:8px; background:var(--card-bg); color:var(--text-primary); outline:none; cursor:pointer;';
    options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.innerText = opt;
        if (opt === current) o.selected = true;
        sel.appendChild(o);
    });
    sel.onchange = (e) => onUpdate(e.target.value);
    wrap.appendChild(sel);
    // Sync the callback with the actual selected value on creation
    // (browser defaults to first option without firing onchange)
    if (sel.value && sel.value !== current) onUpdate(sel.value);
    return wrap;
}

function createSectionBox(hostId, linkId, linkInstId) {
    sendMessage('createClashSectionBox', { hostId, linkId, linkInstId });
}

// H4: showErrorDialog was previously defined here as a dead duplicate that appended a new
// overlay div on every call, causing stacked overlays. The correct implementation using
// the pre-existing #error-overlay element is defined further down in the file.

function renderClashChart(report, canvas) {
    const isLight = document.body.classList.contains('light-mode');
    if (clashChart) clashChart.destroy();

    // 1. Extract unique Levels and Tests
    const testResults = report.IndividualTestResults || [];
    const allLevelNames = new Set();
    const testNames = testResults.map(tr => tr.TestName);
    
    testResults.forEach(tr => {
        if (tr.Clashes) {
            tr.Clashes.forEach(c => {
                allLevelNames.add(c.LevelName || 'No Level');
            });
        }
    });
    
    const sortedLevels = Array.from(allLevelNames).sort();

    // 2. Map colors to levels
    const levelColors = [
        '#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#8b5cf6', 
        '#ec4899', '#06b6d4', '#84cc16', '#ef4444', '#3b82f6'
    ];
    const getColor = (idx) => levelColors[idx % levelColors.length];

    // 3. Prepare Datasets (One per Level)
    const datasets = sortedLevels.map((lvl, i) => {
        const data = testResults.map(tr => {
            if (!tr.Clashes) return 0;
            return tr.Clashes.filter(c => (c.LevelName || 'No Level') === lvl).length;
        });

        return {
            label: lvl,
            data: data,
            backgroundColor: getColor(i),
            borderRadius: 4,
            maxBarThickness: 40
        };
    });

    clashChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: testNames,
            datasets: datasets
        },
        options: {
            maintainAspectRatio: false,
            scales: {
                y: { 
                    stacked: true,
                    beginAtZero: true, 
                    grid: { color: isLight ? '#f1f5f9' : '#334155', drawBorder: false }, 
                    ticks: { color: isLight ? '#64748b' : '#94a3b8', font: { family: "'Outfit', sans-serif" }, precision: 0 } 
                },
                x: { 
                    stacked: true,
                    grid: { display: false }, 
                    ticks: { color: isLight ? '#64748b' : '#94a3b8', font: { family: "'Outfit', sans-serif" } } 
                }
            },
            plugins: { 
                legend: { 
                    display: true, 
                    position: 'bottom',
                    labels: {
                        color: isLight ? '#64748b' : '#94a3b8',
                        font: { size: 10, family: "'Outfit', sans-serif" },
                        boxWidth: 8,
                        usePointStyle: true
                    }
                },
                tooltip: {
                    backgroundColor: isLight ? '#ffffff' : '#1e293b',
                    titleColor: isLight ? '#1e293b' : '#f8fafc',
                    bodyColor: isLight ? '#64748b' : '#cbd5e1',
                    borderColor: 'rgba(99, 102, 241, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${ctx.formattedValue} Clashes`
                    }
                }
            }
        }
    });
}

function zoomToClash(elementId) {
    sendMessage('selectElements', { ids: [elementId] });
}

function createMultiSelectDropdown(container, placeholderText, optionsArray, selectedValues, onChangeCallback) {
    container.innerHTML = '';
    const dropdownWrapper = document.createElement('div');
    dropdownWrapper.style.position = 'relative';
    dropdownWrapper.className = 'flex-2 custom-dropdown-wrapper';
    dropdownWrapper.style.flex = '2';
    dropdownWrapper.style.width = '100%';
    
    const triggerBtn = document.createElement('button');
    triggerBtn.type = 'button';
    triggerBtn.style.width = '100%';
    triggerBtn.style.textAlign = 'left';
    triggerBtn.style.background = 'var(--card-bg)';
    triggerBtn.style.color = 'var(--text-primary)';
    triggerBtn.style.border = '1px solid var(--border-color)';
    triggerBtn.style.padding = '6px 10px';
    triggerBtn.style.borderRadius = '4px';
    triggerBtn.style.fontSize = '13px';
    triggerBtn.style.display = 'flex';
    triggerBtn.style.justifyContent = 'space-between';
    triggerBtn.style.alignItems = 'center';
    triggerBtn.style.boxShadow = 'none';
    triggerBtn.style.minHeight = '33px';

    const updateTriggerText = () => {
        const count = selectedValues ? selectedValues.length : 0;
        const displayValue = count === 0 ? placeholderText : (count === 1 ? selectedValues[0] : count + ' selected');
        triggerBtn.innerHTML = `<span style="text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${displayValue}</span> <span style="font-size:10px; margin-left:8px;">▼</span>`;
    };
    updateTriggerText();

    const dropdownPanel = document.createElement('div');
    dropdownPanel.className = 'custom-dropdown-panel';
    dropdownPanel.style.display = 'none';
    dropdownPanel.style.position = 'absolute';
    dropdownPanel.style.top = '100%';
    dropdownPanel.style.left = '0';
    dropdownPanel.style.width = '100%';
    dropdownPanel.style.maxHeight = '240px';
    dropdownPanel.style.backgroundColor = 'var(--card-bg)';
    dropdownPanel.style.border = '1px solid var(--border-color)';
    dropdownPanel.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    dropdownPanel.style.zIndex = '1000';
    dropdownPanel.style.flexDirection = 'column';
    dropdownPanel.style.borderRadius = '4px';
    dropdownPanel.style.marginTop = '4px';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search...';
    searchInput.style.margin = '8px';
    searchInput.style.padding = '6px';
    searchInput.style.border = '1px solid var(--border-color)';
    searchInput.style.borderRadius = '4px';
    searchInput.style.backgroundColor = 'var(--bg-color)';
    searchInput.style.color = 'var(--text-primary)';

    const listContainer = document.createElement('div');
    listContainer.style.overflowY = 'auto';
    listContainer.style.flex = '1';
    listContainer.style.padding = '0 8px 8px 8px';
    listContainer.style.display = 'flex';
    listContainer.style.flexDirection = 'column';
    listContainer.style.gap = '4px';

    triggerBtn.onclick = (e) => {
        e.stopPropagation();
        const isCurrentlyVisible = dropdownPanel.style.display === 'flex';
        document.querySelectorAll('.custom-dropdown-panel').forEach(p => p.style.display = 'none');
        if (!isCurrentlyVisible) {
            dropdownPanel.style.display = 'flex';
            searchInput.focus();
        }
    };

    const renderList = (filterText) => {
        listContainer.innerHTML = '';
        const lowerFilter = filterText ? filterText.toLowerCase() : '';
        
        if (!optionsArray || optionsArray.length === 0) {
            listContainer.innerHTML = '<span style="font-size:11px; color:var(--text-secondary); padding:4px;">No options available</span>';
            return;
        }

        optionsArray.forEach(v => {
            const displayStr = typeof v === 'object' ? v.label : v;
            const valStr = typeof v === 'object' ? v.value : v;

            if (lowerFilter && !displayStr.toLowerCase().includes(lowerFilter)) return;

            const lbl = document.createElement('label');
            lbl.style.display = 'flex';
            lbl.style.alignItems = 'center';
            lbl.style.gap = '6px';
            lbl.style.fontSize = '12px';
            lbl.style.cursor = 'pointer';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = valStr;
            if (selectedValues && selectedValues.includes(valStr)) {
                cb.checked = true;
            }
            
            cb.onchange = () => {
                if (cb.checked) {
                    if (!selectedValues.includes(valStr)) selectedValues.push(valStr);
                } else {
                    const idx = selectedValues.indexOf(valStr);
                    if (idx > -1) selectedValues.splice(idx, 1);
                }
                updateTriggerText();
                if (onChangeCallback) onChangeCallback(selectedValues);
            };

            lbl.appendChild(cb);
            lbl.appendChild(document.createTextNode(displayStr));
            listContainer.appendChild(lbl);
        });
    };

    renderList('');
    searchInput.oninput = (e) => renderList(e.target.value);

    dropdownPanel.appendChild(searchInput);
    dropdownPanel.appendChild(listContainer);
    dropdownWrapper.appendChild(triggerBtn);
    dropdownWrapper.appendChild(dropdownPanel);

    container.appendChild(dropdownWrapper);
}

// =============================================
// ANALYTICS TAB
// =============================================

const ANALYTICS_COLORS = [
    '#6366f1', // Indigo
    '#10b981', // Emerald
    '#f43f5e', // Rose
    '#f59e0b', // Amber
    '#3b82f6', // Blue
    '#8b5cf6', // Violet
    '#0ea5e9', // Sky
    '#ec4899', // Pink
];

// Monochrome SVG icons for chart types
const CHART_TYPES = [
    {
        value: 'bar', label: 'Bar',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="10" width="4" height="10"/><rect x="10" y="6" width="4" height="14"/><rect x="17" y="2" width="4" height="18"/><line x1="1" y1="21" x2="23" y2="21"/></svg>`
    },
    {
        value: 'horizontalBar', label: 'Horiz. Bar',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="10" height="3"/><rect x="3" y="10" width="16" height="3"/><rect x="3" y="16" width="7" height="3"/><line x1="3" y1="2" x2="3" y2="22"/></svg>`
    },
    {
        value: 'pie', label: 'Pie',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2a10 10 0 1 0 10 10H12V2z"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>`
    },
    {
        value: 'doughnut', label: 'Doughnut',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3a9 9 0 0 1 9 9"/></svg>`
    },
    {
        value: 'stackedBar', label: 'Stacked',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="14" width="4" height="6"/><rect x="3" y="9" width="4" height="5"/><rect x="10" y="10" width="4" height="10"/><rect x="10" y="5" width="4" height="5"/><rect x="17" y="6" width="4" height="14"/><line x1="1" y1="21" x2="23" y2="21"/></svg>`
    },
    {
        value: 'groupedBar', label: 'Grouped',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="8" width="3" height="12"/><rect x="7" y="12" width="3" height="8"/><rect x="13" y="4" width="3" height="16"/><rect x="17" y="9" width="3" height="11"/><line x1="1" y1="21" x2="23" y2="21"/></svg>`
    },
];

const AGGREGATE_FUNCTIONS = [
    { value: 'Count', label: 'Count (by group)' },
    { value: 'Sum', label: 'Sum' },
    { value: 'Average', label: 'Average' },
    { value: 'CountUnique', label: 'Count by Unique Values' },
];

function initAnalytics() {
    document.getElementById('add-chart-btn').addEventListener('click', () => {
        analyticsBuilderState = { step: 'chartType', chartId: 'chart_' + (++analyticsChartIdCounter) };
        showChartBuilderStep();
    });

    document.getElementById('export-analytics-btn').addEventListener('click', exportAnalyticsConfig);
    document.getElementById('import-analytics-btn').addEventListener('click', () => {
        document.getElementById('analytics-import-input').click();
    });
    document.getElementById('analytics-import-input').addEventListener('change', importAnalyticsConfig);
}

function exportAnalyticsConfig() {
    const configs = analyticsCharts.map(c => c.def);
    if (configs.length === 0) { alert('No charts to export.'); return; }
    const blob = new Blob([JSON.stringify(configs, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'analytics_config.json';
    a.click();
    URL.revokeObjectURL(a.href);
}

function importAnalyticsConfig(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const configs = JSON.parse(ev.target.result);
            if (!Array.isArray(configs)) throw new Error('Invalid format');
            configs.forEach(def => {
                if (!def.chartId || !def.category) return;
                def.chartId = 'chart_' + (++analyticsChartIdCounter); // new ID to avoid conflicts
                analyticsBuilderState = { ...def };
                addAnalyticsLoadingCard(def);
                sendMessage('runAnalytics', {
                    ChartId: def.chartId, ChartType: def.chartType,
                    Category: def.category, ValueParameter: def.valueParameter,
                    AggregateFunction: def.aggregateFunction, GroupByParameter: def.groupByParameter || ''
                });
            });
        } catch (err) { alert('Failed to import: ' + err.message); }
    };
    reader.readAsText(file);
    e.target.value = '';
}

function showChartBuilderStep() {
    // Remove any existing builder overlay
    const existingOverlay = document.getElementById('analytics-builder-overlay');
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'analytics-builder-overlay';
    overlay.className = 'modal-overlay active';

    const modal = document.createElement('div');
    modal.className = 'modal-content';
    modal.style.width = '420px';

    const s = analyticsBuilderState;
    const steps = ['chartType','category','parameter','function','groupby'];
    const stepIdx = steps.indexOf(s.step);

    let title = '';
    let body = '';

    const makeSelect = (id, options, val) => {
        return `<select id="${id}" style="width:100%; margin-top:12px;">
            ${options.map(o => `<option value="${o.value}" ${val===o.value?'selected':''}>${o.label}</option>`).join('')}
        </select>`;
    };

    if (s.step === 'chartType') {
        title = 'What type of chart do you want?';
        const selected = s.chartType || 'bar';
        body = `
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-top:16px;">
            ${CHART_TYPES.map(ct => `
                <label style="display:flex; flex-direction:column; align-items:center; gap:8px; padding:16px 8px;
                    border:2px solid ${selected===ct.value ? 'var(--accent)' : 'var(--border-color)'};
                    border-radius:12px; cursor:pointer; background: ${selected===ct.value ? 'rgba(99, 102, 241, 0.05)' : 'transparent'};"
                    onclick="analyticsBuilderState.chartType='${ct.value}'; document.querySelectorAll('.ct-icon-label').forEach(l=>{l.style.borderColor='var(--border-color)';l.style.background='transparent'}); this.style.borderColor='var(--accent)';this.style.background='rgba(99, 102, 241, 0.05)';"
                    class="ct-icon-label">
                    <div style="width:32px; height:32px; color:${selected===ct.value ? 'var(--accent)' : 'var(--text-secondary)'};">${ct.svg}</div>
                    <span style="font-size:12px; font-weight:500;">${ct.label}</span>
                </label>`).join('')}
            </div>`;
    } else if (s.step === 'category') {
        title = 'Which elements should we look at?';
        const catOptions = analyticsAvailableCategories.map(c => ({ value: c.value, label: categoryLabel(c.label) }));
        body = `<p style="font-size:13px; color:var(--text-secondary);">Choose a category from your model to analyze.</p>
            ${makeSelect('builder-category', catOptions, s.category || '')}`;
    } else if (s.step === 'parameter') {
        title = `Great! What parameter of ${categoryLabel(s.category)}?`;
        const paramOptions = analyticsAvailableParameters.map(p => ({ value: p, label: p }));
        body = `<p style="font-size:13px; color:var(--text-secondary);">Select the numerical or text property to measure.</p>
                ${makeSelect('builder-parameter', paramOptions, s.valueParameter || '')}`;
    } else if (s.step === 'function') {
        title = `How should we calculate the result?`;
        body = `<p style="font-size:13px; color:var(--text-secondary);">Do you want to see the total sum, the average, or just count them?</p>
            ${makeSelect('builder-function', AGGREGATE_FUNCTIONS, s.aggregateFunction || 'Count')}`;
    } else if (s.step === 'groupby') {
        title = `Finally, how do you want to group them?`;
        const groupByOptions = [{ value: '', label: '— No Grouping —' }, ...analyticsAvailableParameters.map(p => ({ value: p, label: p }))];
        body = `<p style="font-size:13px; color:var(--text-secondary);">Select a property to split the data (e.g., By Level).</p>
            ${makeSelect('builder-groupby', groupByOptions, s.groupByParameter || '')}`;
    }

    modal.innerHTML = `
        <div class="modal-header">
            <h2>${title}</h2>
            <button onclick="document.getElementById('analytics-builder-overlay').remove()" class="icon-btn">✕</button>
        </div>
        <div class="modal-body">
            <div style="display:flex; gap:4px; margin-bottom:20px;">
                ${steps.map((st, i) => `<div style="flex:1; height:4px; border-radius:2px; background:${i <= stepIdx ? 'var(--accent)' : 'var(--border-color)'}; transition: background 0.3s;"></div>`).join('')}
            </div>
            ${body}
        </div>
        <div class="modal-footer">
            ${stepIdx > 0 ? `<button id="builder-back" class="secondary-btn" style="margin-right:auto;">Back</button>` : ''}
            <button id="builder-cancel" class="secondary-btn" style="margin-right:8px;">Cancel Builder</button>
            <button id="builder-next">${s.step === 'groupby' ? 'Build My Dashboard' : 'Continue'}</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    if (stepIdx > 0) {
        document.getElementById('builder-back').onclick = () => {
            s.step = steps[stepIdx - 1];
            showChartBuilderStep();
        };
    }

    document.getElementById('builder-next').onclick = () => {
        if (s.step === 'chartType') {
            s.chartType = s.chartType || 'bar';
            s.step = 'category';
            showChartBuilderStep();
        } else if (s.step === 'category') {
            s.category = document.getElementById('builder-category').value;
            s.step = 'parameter';
            sendMessage('getAnalyticsParameters', { category: s.category, chartId: s.chartId });
            showChartBuilderStep(); 
        } else if (s.step === 'parameter') {
            s.valueParameter = document.getElementById('builder-parameter').value;
            s.step = 'function';
            showChartBuilderStep();
        } else if (s.step === 'function') {
            s.aggregateFunction = document.getElementById('builder-function').value;
            s.step = 'groupby';
            showChartBuilderStep();
        } else if (s.step === 'groupby') {
            s.groupByParameter = document.getElementById('builder-groupby').value;
            overlay.remove();
            const def = { ...s };
            analyticsCharts.push({ id: s.chartId, def: def });
            sendMessage('runAnalytics', {
                ChartId: def.chartId, ChartType: def.chartType, Category: def.category,
                ValueParameter: def.valueParameter, AggregateFunction: def.aggregateFunction,
                GroupByParameter: def.groupByParameter || ''
            });
            addAnalyticsLoadingCard(def);
        }
    };

    const cancelBtnInFooter = document.getElementById('builder-cancel');
    if (cancelBtnInFooter) {
        cancelBtnInFooter.onclick = () => {
            overlay.remove();
            analyticsBuilderState = {};
        };
    }
}

function onAnalyticsParametersReceived(chartId) {
    // If we're in the parameter step of the matching builder, refresh the view
    if (analyticsBuilderState.chartId === chartId && analyticsBuilderState.step === 'parameter') {
        const existingOverlay = document.getElementById('analytics-builder-overlay');
        if (existingOverlay) existingOverlay.remove();
        showChartBuilderStep();
    }
}

function addAnalyticsLoadingCard(def) {
    const gallery = document.getElementById('analytics-gallery');
    const placeholder = gallery.querySelector('[data-placeholder]');
    if (placeholder) placeholder.remove();

    const chartId = def.chartId;
    const card = document.createElement('div');
    card.className = 'card';
    card.id = 'analytics-card-' + chartId;
    card.innerHTML = `
        <div class="card-header" style="justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
                <div class="spinner" style="width:14px; height:14px; border-width:2px;"></div>
                <span style="font-size:12px; font-weight:500;">Calculating metrics...</span>
            </div>
            <button class="icon-btn close-card" style="font-size:12px; opacity:0.6;" title="Cancel calculation">✕</button>
        </div>`;

    card.querySelector('.close-card').onclick = () => {
        card.remove();
        analyticsCharts = analyticsCharts.filter(c => c.id !== chartId);
    };

    gallery.appendChild(card);

    // Timeout safety
    setTimeout(() => {
        const stillLoading = document.getElementById('analytics-card-' + chartId);
        if (stillLoading && stillLoading.innerHTML.includes('Calculating metrics...')) {
            stillLoading.innerHTML = `
                <div class="card-header" style="justify-content:space-between; align-items:center;">
                    <span style="font-size:12px; color:#ef4444;">Calculation Timeout</span>
                    <button class="icon-btn close-card" style="font-size:12px; opacity:0.6;">✕</button>
                </div>
                <div style="padding:20px; font-size:11px; color:var(--text-secondary);">
                    Revit is taking longer than expected to process this request. Please try again with a smaller category.
                </div>
            `;
            stillLoading.querySelector('.close-card').onclick = () => {
                stillLoading.remove();
                analyticsCharts = analyticsCharts.filter(c => c.id !== chartId);
            };
        }
    }, 20000); // 20s timeout
}

function renderAnalyticsChart(result) {
    if (!result) return;
    const card = document.getElementById('analytics-card-' + result.ChartId);
    if (!card) return;

    // Get the definition for this chart
    const entry = analyticsCharts.find(c => c.id === result.ChartId);
    const def = entry ? entry.def : {};
    const chartType = def.chartType || 'bar';

    // Premium Card Header & Metrics (Match Reference Images)
    const formattedMetric = result.TotalMetric % 1 === 0 ? result.TotalMetric.toLocaleString() : result.TotalMetric.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const desc = `${categoryLabel(def.category)} grouped by ${def.groupByParameter || 'None'}`;

    card.innerHTML = `
        <div class="card-header" style="margin-bottom:0px;">
            <div style="flex:1;">
                <h2>${categoryLabel(def.category)} <span style="font-weight:400; opacity:0.6; font-size:0.9em;">• ${def.aggregateFunction}</span></h2>
                <div class="metric-container">
                    <span class="metric-value">${formattedMetric}</span>
                    <span class="metric-unit">${result.UnitSuffix || ''}</span>
                </div>
                <p style="margin:6px 0 0; font-size:11px; color:var(--text-secondary); line-height:1.2;">${desc}</p>
                ${result.TotalUniqueValues > 0 && result.TotalUniqueValues > result.Labels.length
                    ? `<p style="margin:4px 0 0; font-size:10px; color:#f59e0b;">Showing top ${result.Labels.length} of ${result.TotalUniqueValues} unique values</p>`
                    : ''}
            </div>
            <button data-delete="${result.ChartId}" class="icon-btn" style="background:#f1f5f9; color:#64748b; font-size:10px; width:24px; height:24px;">✕</button>
        </div>
        <div class="chart-container" style="margin-top:16px;">
            <canvas id="canvas-${result.ChartId}"></canvas>
        </div>
    `;

    card.querySelector('[data-delete]').onclick = () => {
        card.remove();
        analyticsCharts = analyticsCharts.filter(c => c.id !== result.ChartId);
    };

    // For horizontal bars, grow the card height to fit all labels without overlap
    const isHorizontalCheck = chartType === 'horizontalBar';
    const labelCount = (result.Labels || []).length;
    const chartHeight = isHorizontalCheck ? Math.max(220, labelCount * 28) : 220;
    card.querySelector('.chart-container').style.height = chartHeight + 'px';

    const ctx = document.getElementById(`canvas-${result.ChartId}`).getContext('2d');

    // Color each bar individually when there is only one dataset (no group-by);
    // when multiple datasets exist (grouped/stacked), each dataset gets its own solid colour.
    const isSingleDataset = (result.Datasets || []).length === 1;
    const perBarColors = (chartType === 'pie' || chartType === 'doughnut' || isSingleDataset);

    // Prepare Data
    const datasets = (result.Datasets || []).map((ds, i) => ({
        label: ds.Label,
        data: ds.Data,
        backgroundColor: perBarColors
            ? ds.Data.map((_, j) => ANALYTICS_COLORS[j % ANALYTICS_COLORS.length])
            : ANALYTICS_COLORS[i % ANALYTICS_COLORS.length],
        borderRadius: chartType === 'bar' || chartType === 'horizontalBar' ? 6 : 0,
        borderWidth: 0,
        maxBarThickness: 40,
        hoverOffset: 4
    }));

    const isHorizontal = isHorizontalCheck;
    const isStacked = chartType === 'stackedBar';
    let baseType = chartType;
    if (baseType === 'stackedBar' || baseType === 'groupedBar' || baseType === 'horizontalBar') baseType = 'bar';

    const instance = new Chart(ctx, {
        type: baseType,
        data: {
            labels: result.Labels,
            datasets: datasets
        },
        options: {
            indexAxis: isHorizontal ? 'y' : 'x',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: datasets.length > 1,
                    position: 'bottom',
                    labels: { boxWidth: 10, usePointStyle: true, font: { family: 'Outfit', size: 10 }, padding: 15 }
                },
                tooltip: {
                    backgroundColor: '#0f172a',
                    titleFont: { family: 'Outfit', size: 12 },
                    bodyFont: { family: 'Outfit', size: 12 },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw.toLocaleString()} ${result.UnitSuffix || ''}`
                    }
                }
            },
            scales: (chartType === 'pie' || chartType === 'doughnut') ? {} : {
                x: {
                    stacked: isStacked,
                    grid: { display: false },
                    ticks: {
                        font: { family: 'Outfit', size: 10 },
                        color: '#94a3b8',
                        maxRotation: isHorizontal ? 0 : 45,
                        autoSkip: true,
                        maxTicksLimit: isHorizontal ? undefined : 20
                    }
                },
                y: {
                    stacked: isStacked,
                    grid: { color: '#f1f5f9', drawBorder: false },
                    ticks: { font: { family: 'Outfit', size: 10 }, color: '#94a3b8', padding: 8 }
                }
            }
        }
    });

    if (entry) {
        entry.chartInstance = instance;
    } else {
        analyticsCharts.push({ id: result.ChartId, def, chartInstance: instance });
    }
}

function showErrorDialog(msg) {
    const overlay = document.getElementById('error-overlay');
    const msgEl = document.getElementById('error-message');
    if (overlay && msgEl) {
        msgEl.innerText = msg || 'An unexpected error occurred in the Revit host.';
        overlay.style.display = 'flex';
    }
}
