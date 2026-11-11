/**
 * All available field keys that can be assigned to a project/subproject.
 */
export const ALL_FIELD_OPTIONS = [
    { key: "from_date", label: "From DOS" },
    { key: "to_date", label: "To DOS" },
    { key: "pos", label: "POS" },
    { key: "start_page", label: "Start Page" },
    { key: "end_page", label: "End Page" },
    { key: "dxcode", label: "DX Code" },
    { key: "details", label: "Code Description" },
    { key: "eo", label: "DX Flag" },
    { key: "dx_location", label: "DX Location" },
    { key: "provider", label: "Meat Flag" },
    { key: "meat_dec", label: "Meat Details" },
    { key: "reject_reason", label: "Reject Reason" },
    { key: "DOS_Flag", label: "DOS Flag" },
];

/** Default dropdown options if not defined in project config */
export const DEFAULT_DROPDOWNS = {
    pos: ["Inpatient", "OutPatient", "Telehealth", "HO"],
    eo: ["NPS", "Unlinked Medication", "Unsupported"],
    dx_location: [
        "HPI", "CC", "PMH", "PL", "Physical Exam",
        "Assessment & Plan", "MedList", "Others"
    ],
    provider: [
        "Evidence of medication",
        "Positive findings elsewhere",
        "provider indicates",
        "No Support Found"
    ],
    reject_reason: [
        "member name is missing",
        "Incorrect Member Name on Chart",
        "No Documented DOS on Chart",
        "Corrupted Image",
        "Illegible Image",
        "No Codable Documents",
        "Invalid Record",
        "Others"
    ]
};

// Always-required core fields (never hidden)
export const CORE_FIELDS = ["dxcode", "details"];

let _configCache = null;

export async function fetchAndCacheProjectConfigs(apiInstance) {
    if (_configCache) return _configCache;
    try {
        const res = await apiInstance.get("/api/project-field-config/");
        _configCache = res.data.configs || [];
    } catch {
        _configCache = [];
    }
    return _configCache;
}

export function invalidateProjectConfigCache() {
    _configCache = null;
}

/**
 * Returns the active fields list for a given project+subproject
 */
export function getFieldsFromCache(project, subproject) {
    if (!_configCache || !project) {
        return ALL_FIELD_OPTIONS.map(f => f.key);
    }
    const match = _configCache.find(
        c => c.project === project && c.subproject === subproject
    );
    return match ? match.fields : ALL_FIELD_OPTIONS.map(f => f.key);
}

/**
 * Returns dynamic dropdown options for a field if defined, else defaults.
 */
export function getDropdownOptions(project, subproject, fieldKey) {
    if (!_configCache || !project) return DEFAULT_DROPDOWNS[fieldKey] || [];

    const match = _configCache.find(
        c => c.project === project && c.subproject === subproject
    );

    if (match && match.dropdowns && match.dropdowns[fieldKey]) {
        return match.dropdowns[fieldKey];
    }

    return DEFAULT_DROPDOWNS[fieldKey] || [];
}

export function getFieldsForProject(project, subproject) {
    return getFieldsFromCache(project, subproject);
}

/**
 * Returns true if NPI provider search is enabled for a given project+subproject
 */
export function getNpiEnabled(project, subproject) {
    if (!_configCache || !project) return false;
    const match = _configCache.find(
        c => c.project === project && c.subproject === subproject
    );
    return match ? !!match.enable_npi : false;
}
