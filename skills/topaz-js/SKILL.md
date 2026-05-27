---
name: topaz-js
description: >
  Write, review, and debug Topaz JavaScript scripts for EventService. Use this skill
  whenever the user mentions Topaz, EventService, KafkaEvent, HttpRequestEvent, or asks
  to write/fix/review JS scripts that run on the .NET runtime. Triggers on: "напиши скрипт
  для Topaz", "Topaz script", "EventService handler", "KafkaEvent", "HttpRequestEvent",
  "скрипт для обработки события", "Topaz JS", "JavaScriptRecipient". Always use this skill
  when writing or reviewing any script that uses Message, Producer, HttpClient, Logger,
  or other Topaz injected globals — even if the user doesn't say "Topaz" explicitly.
---

# Topaz JavaScript Skill

Topaz использует **синтаксис JavaScript**, но выполняется на **.NET runtime**. Это принципиальное
различие определяет каждое решение при написании скрипта.

## Быстрая справка: JS vs .NET

| Нельзя (JS built-ins)         | Нужно (.NET PascalCase)                     |
|-------------------------------|---------------------------------------------|
| `str.trim()`                  | `str.Trim()`                                |
| `str.toLowerCase()`           | `str.ToLower()`                             |
| `str.split(".")`              | `str.Split(".")` → `.Length` (не `.length`) |
| `str.includes()`              | `str.Contains()`                            |
| `new RegExp(...)`, `/regex/`  | `.IndexOf()`, `.Contains()`, `.StartsWith()`|
| `console.log()`               | `Logger.LogInformation(...)`                |
| `fetch()`                     | `HttpClient.Get/Post/PostJson/Patch/Delete` |
| `new Date()`                  | `DateTime`, `DateTimeOffset`, `DateOnly`    |
| `JSON.parse/stringify`        | `JSON.parse()` / `JSON.stringify()` ✅ (injected) |
| `Promise.all()`               | не поддерживается                           |

## Инжектированные глобалы

| Глобал         | Описание                                                                            |
|----------------|-------------------------------------------------------------------------------------|
| `Message`      | Payload события (Kafka message body или HTTP request body)                          |
| `Key`          | Kafka message key                                                                   |
| `Event`        | `{ Id: long, Name: string }` — метаданные события                                  |
| `Urls`         | Dictionary: `Agreement`, `Client`, `Printable`, `Application`, `Subsy`, `Campaign` |
| `HttpClient`   | `.Get()`, `.Post()`, `.PostJson()`, `.Patch()`, `.JsonPatch()`, `.Delete()`         |
| `Producer`     | `.Produce()` / `.ProduceAsync(topic, object, key?, headers?)`                       |
| `Logger`       | `LogDebug`, `LogInformation`, `LogWarning`, `LogError`                              |
| `JSON`         | `JSON.stringify()` / `JSON.parse()`                                                 |
| `require`      | Загрузить другой JavaScriptRecipient по имени                                       |
| `DateTime`     | `.Parse()`, `.UtcNow`, `.Now`, `.Today`, `.ToString()`, `.Compare()`                |
| `DateTimeOffset` | `.Parse()`, `.UtcNow`, `.Now`, `.ToString()`, `.Compare()` — с тайм-зоной        |
| `DateOnly`     | `.Parse()`, `.FromDateTime()`                                                       |
| `Guid`         | `.NewGuid().ToString()`                                                             |
| `Math`         | `.Round()`, `.Abs()`, `.Floor()`, `.Ceiling()`                                      |

---

## Структура скрипта

### KafkaEvent (consumer)

```js
async function processEvent() {
  try {
    // логика обработки
    Logger.LogInformation("Processed {Id}", Message.Id);
  } catch (error) {
    Logger.LogError(error, "Failed for {Id}", Message.Id);
  }
}

await processEvent();
```

> ⚠️ Kafka consumer **никогда не возвращает значение** — только `return;` для раннего выхода.

### HttpRequestEvent (handler)

```js
async function handleRequest() {
  try {
    const result = await HttpClient.Get(Urls.Agreement + "/" + Message.Id);
    return HttpResponse.Ok(await result.AsJson());
  } catch (error) {
    Logger.LogError(error, "Failed for {Id}", Message.Id);
    return HttpResponse.StatusCode(500, { error: error.ToString() });
  }
}

return await handleRequest();
```

> ⚠️ HttpRequestEvent **обязан** `return await handleRequest();` на верхнем уровне.

---

## Паттерны

### Безопасная обработка HTTP-ответа

```js
const resp = await HttpClient.PostJson(url, payload);

if (!resp.IsSuccessStatusCode) {
  const body = await resp.AsString();
  Logger.LogWarning("Failed {Status}: {Body}", resp.StatusCode, body);
  return;
}

const content = await resp.AsString();
if (!content || content.Trim() === "") {
  Logger.LogInformation("Empty response, skipping");
  return;
}

const data = JSON.parse(content);
```

> `AsJson()` бросает исключение на пустом теле (204, пустой ответ) — всегда используй `AsString()` + `JSON.parse()`.

### Работа со строками без RegExp

```js
// Проверка и извлечение
const idx = str.IndexOf(":");
if (idx >= 0) {
  const prefix = str.Substring(0, idx);
  const rest   = str.Substring(idx + 1).Trim();
}

// Замена
const clean = str.Replace("{placeholder}", value);

// Проверки
if (str.StartsWith("ERR_")) { ... }
if (str.Contains("@"))      { ... }
```

### Работа с датами

```js
// Null-guard обязателен перед Parse
if (!Message.DateField) return;

const dt = DateTimeOffset.Parse(Message.DateField);
const now = DateTimeOffset.UtcNow;

// Форматирование
const formatted = dt.ToString("yyyy-MM-dd");
```

### Produce в Kafka

```js
await Producer.ProduceAsync("topic-name", {
  Id: Message.Id,
  Status: "processed",
  Timestamp: DateTimeOffset.UtcNow.ToString("o")
}, Key);
```

### require (переиспользование логики)

```js
const helper = require("SharedHelperRecipient");
const result = await helper.doSomething(Message.Id);
```

---

## Критические правила (чеклист перед выдачей кода)

- [ ] Скрипт обёрнут в `async function name() { ... }` + вызов `await name();` / `return await name();`
- [ ] Внутри функции есть `try/catch`
- [ ] Все async-операции используют `await` (`AsJson()`, `AsString()`, `ProduceAsync()`)
- [ ] `Logger.LogError(error, "template", args)` — исключение **первым** аргументом
- [ ] Переменные, нужные в нескольких блоках, объявлены **на уровне функции** (не внутри `try`)
- [ ] Kafka consumer не возвращает значение (`return;` только для раннего выхода)
- [ ] `.Split()` → `.Length` (не `.length`)
- [ ] Null-guard перед `DateTime.Parse()` и перед доступом к полям из `Message`
- [ ] Нет `Logger.BeginScope()`
- [ ] Нет `RegExp`, `/pattern/g`, `Regex.Match()` — только `.IndexOf()`, `.Contains()`, `.Replace()`
- [ ] Все строковые методы в PascalCase: `Trim()`, `ToLower()`, `ToUpper()`, `Split()`, `Replace()`
- [ ] Нет `.Result`, `.Wait()` — deadlock
- [ ] `AsJson()` не вызывается напрямую без проверки пустого тела

---

## Частые ошибки и как их избежать

| Ошибка | Симптом | Правило |
|--------|---------|---------|
| `str.trim()` | Runtime error | Используй `str.Trim()` |
| `AsJson()` на пустом теле | Exception | Сначала `AsString()`, потом `JSON.parse()` |
| `let x` внутри `try`, используется в `catch` | ReferenceError | Объявляй `let x` до `try` |
| `return data` в Kafka consumer | Игнорируется / ошибка | Только `return;` |
| `Logger.LogError("msg", error)` | Неправильный стек | `Logger.LogError(error, "msg")` |
| Нет `await` у `ProduceAsync` | Сообщение теряется | Всегда `await` |
| `arr.split(".").length` | `.length` не работает в .NET | `.Split(".").Length` |