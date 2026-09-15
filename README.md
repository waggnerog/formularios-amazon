# Portal de Campo — Amazon Devices

Portal em HTML/CSS/JavaScript puro publicado em **[waggnerog/formularios-amazon](https://github.com/waggnerog/formularios-amazon)**, preparado para GitHub Pages, com Supabase como backend de respostas, autenticação e arquivos.

## O que está pronto

- 10 formulários operacionais em layout simples, responsivo e semelhante ao Google Forms.
- Formulários públicos sem login.
- Admin protegido por e-mail e senha.
- Respostas e anexos invisíveis para o público.
- Fotos, PDFs e vídeos em bucket privado e persistente.
- Upload direto de fotos, PDFs e vídeos, com indicação de andamento na tela.
- Exportação de cada filtro e de todos os formulários para Excel.
- Um chamado Excel por resposta de manutenção, com 3 fotos incorporadas e botão para o vídeo.
- Chamados em lote dentro de um ZIP.
- Exclusão completa de uma resposta e seus arquivos.
- Limpeza de envios interrompidos com mais de 24 horas.

## Arquivos

- `index.html`: site completo e configuração pública do Supabase.
- `supabase-setup.sql`: banco, funções protegidas, RLS e bucket privado.
- `.nojekyll`: impede processamento desnecessário pelo Jekyll no GitHub Pages.
- `scripts/check.mjs`: verificação local sem dependências.

## Ativação do backend

1. Crie um projeto gratuito no Supabase.
2. Abra **SQL Editor**, cole todo o conteúdo de `supabase-setup.sql` e execute.
3. Em **Authentication > Users**, crie o único usuário administrador com seu e-mail e uma senha forte.
4. Copie o UUID desse usuário e execute no SQL Editor:

```sql
insert into public.admin_users(user_id)
values ('COLE_AQUI_O_UUID')
on conflict (user_id) do nothing;
```

5. Em **Authentication**, desative novos cadastros públicos. Os consultores não precisam de conta para responder.
6. Em **Project Settings > API**, copie a Project URL e a chave pública/anon.
7. No início do script de `index.html`, substitua somente:

```js
const SUPABASE_URL = "COLE_AQUI_SUA_SUPABASE_URL";
const SUPABASE_ANON_KEY = "COLE_AQUI_SUA_SUPABASE_ANON_KEY";
```

A chave pública pode ficar no HTML. A segurança está nas permissões do banco. Nunca coloque a `service_role` no arquivo.

## Publicação no GitHub Pages

Os arquivos já estão na branch `main`. Para ativar o endereço público:

1. Abra **Settings > Pages** no repositório.
2. Em **Build and deployment**, escolha **Deploy from a branch**.
3. Selecione a branch `main`, a pasta `/ (root)` e salve.

Endereço do portal após a ativação:

```text
https://waggnerog.github.io/formularios-amazon/
```

## Como os arquivos ficam protegidos

O visitante não recebe permissão direta para gravar nas tabelas. O backend valida o formulário, cria uma resposta pendente e reserva um caminho aleatório para cada anexo. O bucket só aceita esses caminhos durante duas horas. A resposta só aparece no Admin depois que todos os arquivos reservados foram recebidos.

O Admin cria links temporários para abrir anexos. No chamado Excel, o botão do vídeo vale por 30 dias; basta gerar novamente o chamado para renovar o link.

## Limites e limpeza

- Fotos, PDFs e evidências: até 15 MB por arquivo.
- Vídeo de manutenção: até 200 MB.
- Use **Excluir** para remover uma resposta concluída e seus arquivos.
- Use **Limpar incompletos** para apagar envios interrompidos há mais de 24 horas.

O portal não inclui CAPTCHA nem bloqueio avançado contra spam. Para este uso operacional, as permissões já evitam leitura pública e upload fora do fluxo, sem criar uma infraestrutura pesada.

## Verificação local

Com Node.js instalado:

```bash
npm test
```

O teste confere a sintaxe do JavaScript, os 10 formulários, os anexos obrigatórios da manutenção e o contrato básico de segurança.
