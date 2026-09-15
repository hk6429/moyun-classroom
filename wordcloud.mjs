export function normalizeWord(value){
 if(typeof value!=='string')throw Error('請輸入一個 30 字以內的詞語或短語');
 const text=value.normalize('NFKC').trim().replace(/[\t ]+/g,' ');
 if(!text||[...text].length>30||/[\p{Cc}\p{Cf}]/u.test(text))throw Error('請輸入一個 30 字以內的詞語或短語，不可換行');
 return text;
}

export function countWords(answers){
 const counts=new Map();
 for(const answer of answers){
  const text=normalizeWord(answer),key=text.toLowerCase();
  const word=counts.get(key)||{text,count:0};word.count++;counts.set(key,word);
 }
 return [...counts.values()].sort((a,b)=>b.count-a.count||a.text.localeCompare(b.text,'zh-Hant'));
}
