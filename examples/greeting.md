---
description: Simple 3-step greeting workflow
literate: true
---

```yaml {config}
step: ask-name
parse:
  name: string
```

Please tell me your name so I can personalize your experience.

---

```yaml {config}
step: confirm
parse:
  confirmed: bool
```

**$name**, it's wonderful to meet you! Would you like me to greet you formally? Please confirm.

---

```yaml {config}
step: greet
next:
  "confirmed === true": formal
  _: casual
```

Routing...

---

```yaml {config}
step: formal
stop: true
```

It is my distinct pleasure to greet you, **$name**. Welcome to our community. Your presence has been noted with the highest regard.

---

```yaml {config}
step: casual
stop: true
```

Hey **$name**! Great to have you here. 🎉
