# Sync Mac ↔ Cloud / iPhone — GitHub è la buca delle lettere

Stesso modello di Minda, **senza il Raspberry Pi**.

**Mac Cursor / Cloud Agent / iPhone → GitHub `main` → gli altri pullano.**

Non serve che Mac e telefono siano accesi insieme. Le chat non si sincronizzano: solo codice e documenti committati.

## Cursor Mobile (come Minda)

1. Il repo è privato su GitHub (`alessandroarmiento-lang/…`).
2. Su iPhone apri **Cursor** → nuovo Cloud Agent → scegli **questo** repository (un agente = un repo).
3. L’agente parte da `main`. A fine lavoro deve sbarcare su `main` (`./deploy/land_on_main.sh`).
4. Quando riapri il Mac, gli hook fanno pull: stesso albero.

## Automatico

| Quando | Cosa |
|---|---|
| Inizio sessione / prima di lavorare | hook → `deploy/check_github_before_work.sh` (pull se il tree è pulito) |
| Fine sessione | hook → commit di backup + push + `land_on_main.sh` |
| Lavoro finito | `./deploy/land_on_main.sh` così tutti vedono `main` |

## A mano se serve

```bash
./deploy/check_github_before_work.sh
./deploy/land_on_main.sh
```

## Cosa non si sincronizza

- File non committati
- `.env` e altri secret
- La chat di Cursor
