# Termômetro de humor — Box Tools Network

## Finalidade

Avalia o tom das mensagens recentes do cliente nos atendimentos do OPA e apresenta um indicador compacto na lista lateral. O cartão mostra a categoria do humor; ao passar o mouse, abre um resumo, e o botão `?` abre uma janela independente com as mensagens, pontuações e sinais considerados.

## Como funciona

- Analisa as últimas **7 mensagens com texto do cliente**.
- Aplica pesos de recência: `1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4`.
- Considera as regras em `humor-regras.js` e o motor em `humor.js`.
- Observa mudanças na interface do OPA e atualiza o cartão do atendimento aberto.
- Ao reabrir um atendimento, substitui a avaliação anterior daquele ID.
- A leitura das mensagens diretamente dos cartões sem abrir o atendimento é uma ideia futura e **não está implementada**.

## Cache e privacidade

As avaliações são armazenadas apenas em `chrome.storage.local` no perfil local do navegador. O registro contém ID do atendimento, categoria, média, horário de gravação/expiração e até 7 mensagens, com pontuações e sinais. O cache expira em **24 horas**. O armazenamento limita a quantidade de registros e o tamanho agregado para evitar exceder a quota local. O módulo não envia as mensagens para um serviço remoto.

A expiração é agendada pelo service worker usando `chrome.alarms`. Quando o Chrome está fechado/suspenso, a limpeza é executada assim que o service worker volta a iniciar; alarmes do navegador podem ser postergados enquanto o equipamento está suspenso.

## Estrutura

- `config.js`: versão e parâmetros do motor.
- `dom.js`: leitura de mensagens, identificação do atendimento e cartões da lista.
- `humor-regras.js`: termos e regras de classificação.
- `humor.js`: pontuação e classificação das mensagens.
- `storage.js`: cache local, limite de armazenamento e expiração.
- `termometro.js`: selo, resumo e janela de mensagens.
- `styles.css`: estilos da interface atual.
- `main.js`: inicialização, observação do DOM e ciclo de atualização.
- `background.js`: agendamento da limpeza de registros expirados.

O `background.js` da extensão importa `modules/opa/termometro/background.js` para registrar o alarme no service worker principal.

## Aviso de terceiros

Partes do mecanismo de análise foram adaptadas do projeto **OPA-Notify**. A licença MIT e os avisos de copyright de origem são reproduzidos aqui para manter o aviso junto à documentação do módulo, sem um arquivo de licença separado.

MIT License

Copyright (c) 2026 Victor Andriolli
Opa!Alert (referência para agrupamento e mensagens): Copyright (c) 2023 JanineMilena

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
