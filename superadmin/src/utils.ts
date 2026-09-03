export const escapeCsvCell = (cell: any): string => {
    if (cell === null || cell === undefined) return '""';
    const raw = typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
    const sanitized = /^[\t\r\n ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${sanitized.replace(/"/g, '""')}"`;
};

export const Utils = {
    $: (id: string): HTMLElement | null => document.getElementById(id),
    show: (id: string) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'block';
    },
    hide: (id: string) => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    },
    escapeHtml: (str: any): string => {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },
    toast: (msg: string, type: 'ok' | 'err' | 'info' | 'warn' = 'info') => {
        const wrap = document.getElementById('toast-wrap');
        if (!wrap) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type} anim-fade-in`;
        
        let icon = 'fa-info-circle';
        if (type === 'ok') icon = 'fa-circle-check';
        if (type === 'err') icon = 'fa-triangle-exclamation';
        if (type === 'warn') icon = 'fa-circle-exclamation';
        
        toast.innerHTML = `<i class="fa-solid ${icon} mr-2"></i><span>${Utils.escapeHtml(msg)}</span>`;
        wrap.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-10px)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    },
    formatBytes: (bytes: number): string => {
        if (bytes === 0 || isNaN(bytes)) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },
    exportCsv: (filename: string, headers: string[], rows: any[][]) => {
        const parts: string[] = [];
        parts.push(headers.map(escapeCsvCell).join(',') + '\n');

        const total = rows.length;
        const chunkSize = 10000;

        for (let i = 0; i < total; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            const chunkLines = chunk.map(row =>
                row.map(escapeCsvCell).join(',')
            );
            parts.push(chunkLines.join('\n') + '\n');
        }

        const blob = new Blob(parts, { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `${filename}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },
    exportJson: (filename: string, data: any) => {
        const jsonContent = JSON.stringify(data);
        const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `${filename}.json`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    },
    copyToClipboard: async (text: string): Promise<boolean> => {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            return false;
        }
    }
};
