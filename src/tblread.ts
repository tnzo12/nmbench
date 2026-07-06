import * as fs from 'fs';

export async function readNmTable(filePath: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                reject(err);
                return;
            }
            const lines = data.split('\n').filter(line => line.trim() !== '');
            const header = lines[1].trim().split(/\s+/);
            const rows = lines.slice(2).map(line => {
                const values = line.trim().split(/\s+/);
                const row: { [key: string]: string | number } = {};
                header.forEach((col, index) => {
                    row[col] = isNaN(Number(values[index])) ? values[index] : Number(values[index]);
                });
                return row;
            });
            resolve(rows);
        });
    });
}
export async function readNmTable_heatmap(filePath: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                reject(err);
                return;
            }
            const lines = data.split('\n').filter(line => line.trim() !== '');
            const header = lines[1].trim().split(/\s+/);
            const rows = lines.slice(1).map(line => {
                const values = line.trim().split(/\s+/);
                const row: { [key: string]: string | number } = {};
                header.forEach((col, index) => {
                    row[col] = isNaN(Number(values[index])) ? values[index] : Number(values[index]);
                });
                return row;
            });
            resolve(rows);
        });
    });
}
export async function readNmTable_ext(filePath: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                reject(err);
                return;
            }

            // Split the content into lines
            const lines = data.split('\n').filter(line => line.trim() !== '');

            // Split into sections based on "TABLE NO"
            const sections: { tableNoLine: string, lines: string[] }[] = [];
            let currentSection: string[] = [];
            let currentTableNoLine = '';

            lines.forEach(line => {
                if (line.trim().startsWith('TABLE NO')) {
                    if (currentSection.length > 0) {
                        sections.push({ tableNoLine: currentTableNoLine, lines: currentSection });
                    }
                    currentSection = [line];
                    currentTableNoLine = line;
                } else {
                    currentSection.push(line);
                }
            });
            if (currentSection.length > 0) {
                sections.push({ tableNoLine: currentTableNoLine, lines: currentSection });
            }

            // Process each section
            const tables = sections.map(({ tableNoLine, lines }) => {
                const headerLine = lines.find(line => line.trim().startsWith('ITERATION'));
                if (!headerLine) {
                    return null;
                }

                const header = headerLine.trim().split(/\s+/);
                const rows = lines
                    .filter(line => !line.trim().startsWith('TABLE NO') && !line.trim().startsWith('ITERATION'))
                    .map(line => {
                        const values = line.trim().split(/\s+/);
                        const row: { [key: string]: string | number } = {};
                        header.forEach((col, index) => {
                            row[col] = isNaN(Number(values[index])) ? values[index] : Number(values[index]);
                        });
                        return row;
                    });

                // Separate rows where ITERATION is greater than -1000000000 and less than or equal to -1000000000
                const filteredRows = rows.filter(row => (row['ITERATION'] as number) > -1000000000);
                const extendedRows = rows.filter(row => (row['ITERATION'] as number) <= -1000000000);

                if (filteredRows.length === 0) {
                    return null;
                }

                const firstRow = filteredRows[0];
                const lastRow = filteredRows[filteredRows.length - 1];

                // Sparkline data for each column
                const sparklineData: { [key: string]: number[] } = {};
                header.forEach(col => {
                    if (typeof firstRow[col] === 'number') {
                        sparklineData[col] = filteredRows.map(row => row[col] as number);
                    }
                });

                return { tableNoLine, firstRow, lastRow, sparklineData, header, extendedRows };
            }).filter(table => table !== null);

            resolve(tables);
        });
    });
}