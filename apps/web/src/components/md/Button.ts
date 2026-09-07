import React from 'react';
import { createComponent } from '@lit/react';
import { MdFilledButton } from '@material/web/button/filled-button.js';

export const FilledButton = createComponent({
  tagName: 'md-filled-button',
  elementClass: MdFilledButton,
  react: React,
});
