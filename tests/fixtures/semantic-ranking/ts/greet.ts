export function tsFormatName(name: string): string {
  return name.trim();
}

export function tsGreet(name: string): string {
  return `Hello, ${tsFormatName(name)}!`;
}
