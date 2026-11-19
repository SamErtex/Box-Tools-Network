# Box Tools Network — v7.0.1

Extensão Chrome com ferramentas para suporte IXC, automação de atendimento e utilitários de rede.

## Módulos

| Módulo | Localização | Responsabilidade |
|---|---|---|
| OPA | `modules/opa/` | Interface AUTO, integração com a fila IXC, exibição do tempo na fila atual, assunção, marcação de aguardando cliente e monitoramento. |
| OPA-EXTERNO | `modules/opa-externo/` | Redirecionamento relacionado ao fluxo externo para `adm.php`. Não possui interface própria. |
| Revelação de senhas | `modules/externo/reveal-password/` | Revelação de campos de senha nas rotas permitidas, conforme a configuração do usuário. |
| Validador de IP | `modules/externo/validate-ip/` | Captura temporária de endereços IP durante a utilização da ferramenta no popup. |
| IXC Dev Tools | `modules/externo/ixc-dev-tools/` | Integração de ferramentas de desenvolvimento nas páginas `adm.php`. |

## Organização principal

- `manifest.json`: permissões, páginas, scripts, correspondências de URL e recursos da extensão.
- `background.js`: ponto de entrada do service worker; importa os módulos de background.
- `core/`: serviços compartilhados de log, armazenamento, notificações e comunicação com abas.
- `modules/opa/`: scripts de conteúdo, ponte MAIN world, background e estilos do OPA.
- `modules/opa-externo/`: redirecionamento externo.
- `modules/externo/`: ferramentas auxiliares e IXC Dev Tools.
- `popup.html` e `popup.js`: popup atual da extensão.
- `options.html` e `options.bundle.js`: página de opções.
- `panel.html` e `panel.bundle.js`: painel do Dev Tools.
- `devtools.html`: página de integração com o Chrome DevTools.
- `icon16.png`, `icon48.png`, `icon128.png`: ícones da extensão.
- `e99cb3e708e397f3d230.svg`: recurso gráfico utilizado pela extensão.

Os bundles compilados `options.bundle.js`, `panel.bundle.js` e os bundles do IXC Dev Tools foram preservados. Seus caminhos não devem ser alterados sem revisar também as referências internas e o `manifest.json`.

## CORE

O CORE é carregado antes dos módulos pelo `background.js` e disponibiliza `globalThis.BoxCore` no service worker:

- `BoxCore.logger`: logs padronizados por módulo.
- `BoxCore.storage`: operações uniformes em `chrome.storage` (`local` por padrão; `session` quando solicitado).
- `BoxCore.notifications`: criação e limpeza automática de notificações nativas.
- `BoxCore.messaging`: envio de mensagens para abas, tratando abas indisponíveis sem interromper o módulo.

As regras de negócio permanecem nos módulos. O CORE não decide quando assumir atendimentos, monitorar filas ou executar ferramentas externas. A migração para os serviços compartilhados é gradual; funcionalidades que ainda acessam diretamente APIs do Chrome continuam assim até uma refatoração específica e testada.

## Interface

A interface visual existente foi preservada:

- OPA: botão AUTO integrado à interface do suporte IXC.
- EXTERNO: popup aberto pelo ícone da extensão.
- OPA-EXTERNO: sem interface própria.

## Instalação para teste

1. Extraia o ZIP em uma pasta.
2. Abra `chrome://extensions`.
3. Ative o **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta extraída.
6. Acesse o sistema IXC e valide os módulos que utiliza.

## Cuidados de manutenção

- As permissões declaradas em `manifest.json` devem corresponder a funcionalidades efetivamente utilizadas. Antes de adicionar uma permissão, verifique se uma API mais restrita atende ao caso de uso e documente a necessidade.
- Ao mover scripts, atualize todas as referências no manifesto, nas páginas HTML e nos caminhos gerados por `chrome.runtime.getURL`.
- Não edite manualmente bundles compilados sem necessidade.
- Testes locais de sintaxe e de referências não substituem a validação funcional no Chrome com o sistema IXC.

## Documentação complementar

- `RELEASE_NOTES_V7.0.1.txt`: limpeza de permissões não utilizadas para adequação à revisão da Chrome Web Store.
- `RELEASE_NOTES_V7.0.0.txt`: alterações e detalhes técnicos da versão.
- `POLITICA_DE_PRIVACIDADE.txt`: política de privacidade.
- `IPVFOO_NOTICE.txt` e `LICENSE-APACHE-2.0.txt`: atribuição e licença relacionadas à implementação do validador de IP.
