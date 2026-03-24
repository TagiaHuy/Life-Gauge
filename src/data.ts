export interface Stat {
    id: string;
    name: string;
    icon: string;
    description?: string;
    currentXp: number;
    level: number;
    color: string;
    baseXp: number;
    xpIncrement: number;
}

export interface Title {
    threshold: number;
    name: string;
    icon: string;
    description: string;
}
export interface CustomShopItem {
    id: string;
    name: string;
    icon: string;
    description: string;
    cost: number;
}

export interface LifeGaugeSettings {
    avatarPath: string;
    taskFilePath: string;
    stats: Stat[];
    titles: Title[];
    skills: Stat[]; // Skills use the same structure as Stats (XP/Level)
    completedTasks: string[];
    penaltyPoint: number;
    refreshInterval: number;
    hunger: number;
    maxHunger: number;
    coins: number;
    lastHungerUpdate: number;
    customShopItems: CustomShopItem[];
}

export const DEFAULT_STATS: Stat[] = [
    {
        id: "stamina",
        name: "Stamina",
        icon: "💪",
        currentXp: 0,
        level: 1,
        color: "#4dff88",
        baseXp: 100,
        xpIncrement: 50
    },
    {
        id: "strength",
        name: "Strength",
        icon: "🧠",
        currentXp: 0,
        level: 1,
        color: "#ffaa4d",
        baseXp: 100,
        xpIncrement: 50
    },
    {
        id: "knowledge",
        name: "Knowledge",
        icon: "📚",
        currentXp: 0,
        level: 1,
        color: "#4da6ff",
        baseXp: 100,
        xpIncrement: 50
    }
];

export const DEFAULT_TITLES: Title[] = [
    {
        threshold: 0,
        name: "The Outcast",
        icon: "⚔️",
        description: "You always feel inadequate and left behind. You fail at most things and doubt your own abilities. Don't give up, keep trying!"
    },
    {
        threshold: 300,
        name: "The Traveler",
        icon: "🚶",
        description: "You've started to find your way. The first steps are always the hardest, but every day you become more steady."
    },
    {
        threshold: 800,
        name: "The Awakened",
        icon: "🔥",
        description: "A small fire has ignited within you. You realize that you can do more than you think."
    },
    {
        threshold: 1500,
        name: "Resilient Warrior",
        icon: "🛡️",
        description: "Challenges no longer make you flinch. You have trained enough to stand firm in the storm."
    },
    {
        threshold: 3000,
        name: "Master",
        icon: "👑",
        description: "Your skills have become legendary in your own community. Others look to you for inspiration."
    },
    {
        threshold: 5000,
        name: "Living Legend",
        icon: "🌟",
        description: "You have surpassed the limits of ordinary humans. Your story will be told for generations."
    }
];

export const DEFAULT_SETTINGS: LifeGaugeSettings = {
    avatarPath: ".life-gauge/avatar.png",
    taskFilePath: "Daily/quests.md",
    stats: DEFAULT_STATS,
    titles: DEFAULT_TITLES,
    skills: [],
    completedTasks: [],
    penaltyPoint: 1,
    refreshInterval: 5,
    hunger: 100,
    maxHunger: 100,
    coins: 0,
    lastHungerUpdate: Date.now(),
    customShopItems: []
};

export function getRequiredXp(level: number, baseXp: number, xpIncrement: number): number {
    return baseXp + (level - 1) * xpIncrement;
}

export function calculateLevel(currentXp: number, baseXp: number, xpIncrement: number): { level: number; remainingXp: number; requiredXp: number } {
    let level = 1;
    let xpNeeded = baseXp;
    let tempXp = currentXp;

    while (tempXp >= xpNeeded) {
        tempXp -= xpNeeded;
        level++;
        xpNeeded = baseXp + (level - 1) * xpIncrement;
    }

    return { level, remainingXp: tempXp, requiredXp: xpNeeded };
}

export function getTotalXp(stats: Stat[]): number {
    return stats.reduce((acc, stat) => acc + stat.currentXp, 0);
}

export function getCurrentTitle(totalXp: number, titles: Title[]): Title {
    const sortedTitles = [...titles].sort((a, b) => b.threshold - a.threshold);
    return sortedTitles.find(t => totalXp >= t.threshold) || titles[0];
}

export function getNextTitle(totalXp: number, titles: Title[]): Title | null {
    const sortedTitles = [...titles].sort((a, b) => a.threshold - b.threshold);
    return sortedTitles.find(t => t.threshold > totalXp) || null;
}
