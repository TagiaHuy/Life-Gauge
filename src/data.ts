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

export interface LifeGaugeSettings {
    avatarPath: string;
    taskFilePath: string;
    stats: Stat[];
    titles: Title[];
    skills: Stat[]; // Skills use the same structure as Stats (XP/Level)
    completedTasks: string[];
    penaltyPoint: number;
    showTotalXp: boolean;
    refreshInterval: number;
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
        name: "Kẻ lạc lõng",
        icon: "⚔️",
        description: "Bạn luôn cảm thấy mình kém cỏi và bị bỏ lại. Bạn thất bại trong hầu hết mọi việc và bạn nghi ngờ khả năng của bản thân. Đừng từ bỏ, hãy tiếp tục cố gắng!"
    },
    {
        threshold: 300,
        name: "Người lữ khách",
        icon: "🚶",
        description: "Bạn đã bắt đầu tìm thấy hướng đi. Những bước chân đầu tiên luôn khó khăn, nhưng mỗi ngày bạn lại vững vàng hơn."
    },
    {
        threshold: 800,
        name: "Kẻ thức tỉnh",
        icon: "🔥",
        description: "Một ngọn lửa nhỏ đã bùng cháy trong bạn. Bạn nhận ra rằng mình có thể làm được nhiều hơn những gì bạn nghĩ."
    },
    {
        threshold: 1500,
        name: "Chiến binh kiên cường",
        icon: "🛡️",
        description: "Những thử thách không còn làm bạn nao núng. Bạn đã rèn luyện đủ để đứng vững trước giông bão."
    },
    {
        threshold: 3000,
        name: "Bậc thầy",
        icon: "👑",
        description: "Kỹ năng của bạn đã trở thành huyền thoại trong cộng đồng của riêng bạn. Người khác nhìn vào bạn để tìm cảm hứng."
    },
    {
        threshold: 5000,
        name: "Huyền thoại sống",
        icon: "🌟",
        description: "Bạn đã vượt qua giới hạn của con người thường. Câu chuyện của bạn sẽ được kể lại qua nhiều thế hệ."
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
    showTotalXp: true,
    refreshInterval: 5
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
