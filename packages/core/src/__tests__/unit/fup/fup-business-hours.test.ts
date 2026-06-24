// FUP-07: Testes unitários de getNextValidSlot — cálculo de próximo slot válido em timezone IANA
// Sem dependência de banco ou rede — testes puros de lógica de negócio
import { describe, test, expect } from "bun:test";
import { getNextValidSlot } from "../../../fup/fup-scheduler.js";

describe("getNextValidSlot", () => {
  const weekdays = ["mon", "tue", "wed", "thu", "fri"];

  test("slot já válido (terça 10h em SP) retorna o mesmo momento", () => {
    // new Date("2025-01-07T13:00:00Z") = terça-feira 10h em America/Sao_Paulo (-3)
    const from = new Date("2025-01-07T13:00:00Z");
    const result = getNextValidSlot(from, 9, 18, weekdays, "America/Sao_Paulo");
    // Deve retornar o mesmo Date (ou muito próximo — mesma hora)
    expect(result.getTime()).toBe(from.getTime());
  });

  test("slot num sábado avança para próxima segunda >=minHour", () => {
    // new Date("2025-01-11T15:00:00Z") = sábado 12h em SP (UTC-3)
    const from = new Date("2025-01-11T15:00:00Z");
    const result = getNextValidSlot(from, 9, 18, weekdays, "America/Sao_Paulo");

    // Deve ser segunda-feira (2025-01-13)
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(result);
    const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase();
    const hourRaw = parts.find((p) => p.type === "hour")?.value ?? "0";
    const hour = parseInt(hourRaw, 10) % 24;

    expect(weekday).toBe("mon");
    expect(hour).toBeGreaterThanOrEqual(9);
    expect(hour).toBeLessThan(18);
  });

  test("slot numa segunda antes do horário comercial avança para minHour", () => {
    // new Date("2025-01-06T09:00:00Z") = segunda 06h em SP (UTC-3)
    const from = new Date("2025-01-06T09:00:00Z");
    const result = getNextValidSlot(from, 9, 18, weekdays, "America/Sao_Paulo");

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(result);
    const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase();
    const hourRaw = parts.find((p) => p.type === "hour")?.value ?? "0";
    const hour = parseInt(hourRaw, 10) % 24;

    expect(weekday).toBe("mon");
    expect(hour).toBeGreaterThanOrEqual(9);
  });

  test("slot numa segunda após horário comercial avança para terça minHour", () => {
    // new Date("2025-01-06T22:00:00Z") = segunda 19h em SP (UTC-3)
    const from = new Date("2025-01-06T22:00:00Z");
    const result = getNextValidSlot(from, 9, 18, weekdays, "America/Sao_Paulo");

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(result);
    const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase();
    const hourRaw = parts.find((p) => p.type === "hour")?.value ?? "0";
    const hour = parseInt(hourRaw, 10) % 24;

    expect(weekday).toBe("tue");
    expect(hour).toBeGreaterThanOrEqual(9);
    expect(hour).toBeLessThan(18);
  });

  test("hora '24' normalizada para 0 (pitfall Intl)", () => {
    // Verificar que parseInt('24', 10) % 24 === 0 (comportamento correto do normalizador)
    // Testar via slot exatamente à meia-noite UTC que resulta em hora local específica
    const hourRaw = "24";
    const hour = parseInt(hourRaw, 10) % 24;
    expect(hour).toBe(0);

    // Testar com meia-noite SP (2025-01-07T03:00:00Z = 2025-01-07 00:00 SP)
    // A função deve lidar corretamente — não travar em hora 24
    const midnight = new Date("2025-01-07T03:00:00Z"); // terça 00h SP
    // Com minHour=9 a função deve avançar para 9h
    const result = getNextValidSlot(midnight, 9, 18, weekdays, "America/Sao_Paulo");
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      hour12: false,
    }).formatToParts(result);
    const hourResult = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
    expect(hourResult).toBeGreaterThanOrEqual(9);
    expect(hourResult).toBeLessThan(18);
  });

  test("fallback: retorna +24h quando allowedDays vazio (config inválida)", () => {
    const from = new Date("2025-01-07T13:00:00Z");
    const result = getNextValidSlot(from, 9, 18, [], "America/Sao_Paulo");
    // Com allowedDays=[] nunca encontra slot válido → retorna from + 86400000ms
    expect(result.getTime()).toBe(from.getTime() + 86_400_000);
  });
});
