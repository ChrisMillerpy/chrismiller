// The ChatGPT plan page, wrapped in the admin shell. Content and script are in chatgpt-ui.ts.
import { page } from './layout.ts';
import { CHATGPT_BODY, CHATGPT_CSS, CHATGPT_JS } from './chatgpt-ui.ts';

export const chatgptPage = () => page({ title: 'ChatGPT plan · Admin', css: CHATGPT_CSS, body: CHATGPT_BODY, script: CHATGPT_JS });
