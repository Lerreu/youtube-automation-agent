// Languages a channel can publish in. The channel's language (Channel setup in
// the dashboard) is stamped on each production, so every audience-facing text
// (script, narration, captions, title, description, tags, thumbnail text) and
// the YouTube language metadata follow it.
const LANGUAGES = {
  'pt-BR': {
    label: 'Português (Brasil)',
    promptName: 'Brazilian Portuguese (pt-BR)',
    region: 'BR',
    captionName: 'Português',
    phrases: {
      subscribe: topic => `Inscreva-se para ver mais sobre ${topic}.`,
      subscribePractical: topic => `Inscreva-se para mais vídeos práticos sobre ${topic}.`,
      like: 'Deixe seu like se este vídeo ajudou.',
      comment: topic => `Conte nos comentários sua experiência com ${topic}.`,
      nextVideo: 'Assista ao próximo vídeo relacionado para saber mais.',
      footer: { website: 'Site', social: 'Redes sociais', business: 'Contato comercial' },
      formatLabels: { Tutorial: 'PASSO A PASSO', Review: 'ANÁLISE', List: 'A LISTA', Explainer: 'EXPLICADO' },
      pillarGuide: (pillar, audience) => `${pillar}: um guia prático para ${audience}`
    }
  },
  'pt-PT': {
    label: 'Português (Portugal)',
    promptName: 'European Portuguese (pt-PT)',
    region: 'PT',
    captionName: 'Português',
    phrases: {
      subscribe: topic => `Subscreva para ver mais sobre ${topic}.`,
      subscribePractical: topic => `Subscreva para mais vídeos práticos sobre ${topic}.`,
      like: 'Deixe o seu gosto se este vídeo ajudou.',
      comment: topic => `Partilhe nos comentários a sua experiência com ${topic}.`,
      nextVideo: 'Veja o próximo vídeo relacionado para saber mais.',
      footer: { website: 'Site', social: 'Redes sociais', business: 'Contacto comercial' },
      formatLabels: { Tutorial: 'PASSO A PASSO', Review: 'ANÁLISE', List: 'A LISTA', Explainer: 'EXPLICADO' },
      pillarGuide: (pillar, audience) => `${pillar}: um guia prático para ${audience}`
    }
  },
  en: {
    label: 'English',
    promptName: 'English',
    region: 'US',
    captionName: 'English',
    phrases: {
      subscribe: topic => `Subscribe for more on ${topic}.`,
      subscribePractical: topic => `Subscribe for more practical videos about ${topic}.`,
      like: 'Like this video if it helped.',
      comment: topic => `Share your experience with ${topic} in the comments.`,
      nextVideo: 'Watch the next related video for more context.',
      footer: { website: 'Website', social: 'Social', business: 'Business inquiries' },
      formatLabels: { Tutorial: 'STEP BY STEP', Review: 'REVIEW', List: 'THE LIST', Explainer: 'EXPLAINED' },
      pillarGuide: (pillar, audience) => `${pillar}: a practical guide for ${audience}`
    }
  },
  es: {
    label: 'Español',
    promptName: 'Spanish',
    region: 'ES',
    captionName: 'Español',
    phrases: {
      subscribe: topic => `Suscríbete para ver más sobre ${topic}.`,
      subscribePractical: topic => `Suscríbete para más videos prácticos sobre ${topic}.`,
      like: 'Dale like si este video te ayudó.',
      comment: topic => `Cuéntanos en los comentarios tu experiencia con ${topic}.`,
      nextVideo: 'Mira el siguiente video relacionado para saber más.',
      footer: { website: 'Sitio web', social: 'Redes sociales', business: 'Contacto comercial' },
      formatLabels: { Tutorial: 'PASO A PASO', Review: 'RESEÑA', List: 'LA LISTA', Explainer: 'EXPLICADO' },
      pillarGuide: (pillar, audience) => `${pillar}: una guía práctica para ${audience}`
    }
  },
  fr: {
    label: 'Français',
    promptName: 'French',
    region: 'FR',
    captionName: 'Français',
    phrases: {
      subscribe: topic => `Abonnez-vous pour en savoir plus sur ${topic}.`,
      subscribePractical: topic => `Abonnez-vous pour plus de vidéos pratiques sur ${topic}.`,
      like: 'Aimez cette vidéo si elle vous a aidé.',
      comment: topic => `Partagez en commentaire votre expérience avec ${topic}.`,
      nextVideo: 'Regardez la prochaine vidéo liée pour aller plus loin.',
      footer: { website: 'Site web', social: 'Réseaux sociaux', business: 'Contact professionnel' },
      formatLabels: { Tutorial: 'ÉTAPE PAR ÉTAPE', Review: 'TEST', List: 'LA LISTE', Explainer: 'EXPLIQUÉ' },
      pillarGuide: (pillar, audience) => `${pillar} : un guide pratique pour ${audience}`
    }
  },
  de: {
    label: 'Deutsch',
    promptName: 'German',
    region: 'DE',
    captionName: 'Deutsch',
    phrases: {
      subscribe: topic => `Abonniere den Kanal für mehr zu ${topic}.`,
      subscribePractical: topic => `Abonniere den Kanal für mehr praktische Videos zu ${topic}.`,
      like: 'Gib dem Video ein Like, wenn es dir geholfen hat.',
      comment: topic => `Teile deine Erfahrungen mit ${topic} in den Kommentaren.`,
      nextVideo: 'Sieh dir das nächste passende Video an, um mehr zu erfahren.',
      footer: { website: 'Website', social: 'Social Media', business: 'Geschäftliche Anfragen' },
      formatLabels: { Tutorial: 'SCHRITT FÜR SCHRITT', Review: 'TEST', List: 'DIE LISTE', Explainer: 'ERKLÄRT' },
      pillarGuide: (pillar, audience) => `${pillar}: ein praktischer Leitfaden für ${audience}`
    }
  },
  it: {
    label: 'Italiano',
    promptName: 'Italian',
    region: 'IT',
    captionName: 'Italiano',
    phrases: {
      subscribe: topic => `Iscriviti per vedere altro su ${topic}.`,
      subscribePractical: topic => `Iscriviti per altri video pratici su ${topic}.`,
      like: 'Metti mi piace se questo video ti è stato utile.',
      comment: topic => `Raccontaci nei commenti la tua esperienza con ${topic}.`,
      nextVideo: 'Guarda il prossimo video correlato per saperne di più.',
      footer: { website: 'Sito web', social: 'Social', business: 'Contatti commerciali' },
      formatLabels: { Tutorial: 'PASSO DOPO PASSO', Review: 'RECENSIONE', List: 'LA LISTA', Explainer: 'SPIEGATO' },
      pillarGuide: (pillar, audience) => `${pillar}: una guida pratica per ${audience}`
    }
  }
};

const DEFAULT_LANGUAGE = 'pt-BR';

function isSupportedLanguage(code) {
  return Object.prototype.hasOwnProperty.call(LANGUAGES, code);
}

// Unknown or missing codes fall back to the default, so a stale value never
// stops generation.
function resolveLanguage(code) {
  const key = isSupportedLanguage(code) ? code : DEFAULT_LANGUAGE;
  return { code: key, ...LANGUAGES[key] };
}

// Appended to every prompt that produces audience-facing text. JSON keys and
// enum values stay in English because the code parses them.
function languageInstruction(code) {
  const language = resolveLanguage(code);
  return `Language: write every audience-facing value (titles, topics, angles, spoken script, descriptions, tags, calls to action, claims) in ${language.promptName}, natural and idiomatic for native speakers. Keep JSON keys and the listed enum values exactly as specified in English.`;
}

// Trending research region: an explicit YOUTUBE_REGION wins, otherwise the
// language's main market.
function regionFor(code) {
  return process.env.YOUTUBE_REGION || resolveLanguage(code).region;
}

module.exports = { LANGUAGES, DEFAULT_LANGUAGE, isSupportedLanguage, resolveLanguage, languageInstruction, regionFor };
