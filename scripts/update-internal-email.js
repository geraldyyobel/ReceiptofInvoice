import {db,audit} from '../server/core.js';
import {withInternalEmail} from '../prisma/internal-email.js';
import {validateDefinition} from '../shared/engine.js';
try {
  const result = await db.$transaction(async tx=>{
    const form = await tx.form.findUniqueOrThrow({where:{mode:'internal'}});
    const previous = await tx.formVersion.findUniqueOrThrow({where:{id:form.currentId}});
    const fields = withInternalEmail(previous.fields);
    validateDefinition(fields,previous.sections);
    if(JSON.stringify(fields)===JSON.stringify(previous.fields))return {unchanged:true};
    const version=await tx.formVersion.create({data:{mode:'internal',fields,sections:previous.sections,note:'Email Internal: pilihan sesuai gambar yang diberikan pengguna.'}});
    await tx.form.update({where:{mode:'internal'},data:{currentId:version.id}});
    const definition=fields.find(f=>f.code==='email_anda');
    await tx.formField.upsert({where:{mode_code:{mode:'internal',code:'email_anda'}},create:{mode:'internal',code:'email_anda',definition},update:{definition}});
    await audit({admin:{email:'perubahan atas permintaan pengguna'},ip:'lokal',mode:'internal'},'form.update',previous.fields,fields,'internal',tx);
    return {mode:'internal',version:version.id,options:definition.options.length};
  });
  console.log(JSON.stringify(result));
}finally{await db.$disconnect();}
