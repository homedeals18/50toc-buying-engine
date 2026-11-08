import {randomBytes,randomUUID,scrypt as derive,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {AppError} from './errors.mjs';
import {text} from './profit.mjs';
const scrypt=promisify(derive),ns='jason_research.',hash=s=>createHash('sha256').update(s).digest('hex');
export class AccessService{
  constructor(db){this.db=db;this.attempts=[];}
  async enabled(){return (await this.db.query('SELECT id FROM '+ns+'accounts LIMIT 1')).rows.length>0;}
  async current(req){
    if(!await this.enabled())return {id:'local-manager',username:'Local manager',role:'manager',local:true};
    const token=req.headers.cookie?.match(/(?:^|;\s*)fiftytoc_login=([a-f0-9]{64})(?:;|$)/)?.[1];if(!token)return null;
    const row=(await this.db.query('SELECT a.id,a.username,a.role,a.body FROM '+ns+'accounts a JOIN '+ns+'logins l ON l.account_id=a.id WHERE l.token_hash=$1 AND l.expires_at>CURRENT_TIMESTAMP AND a.active=TRUE',[hash(token)])).rows[0];
    return row?{id:row.id,username:row.username,role:row.role,local:false}:null;
  }
  cookie(token){return 'fiftytoc_login='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+(token?43200:0);}
  async login(input){
    this.attempts=this.attempts.filter(t=>Date.now()-t<600000);
    if(this.attempts.length>=10)throw new AppError('LOGIN_RATE_LIMIT','Too many sign-in attempts. Wait ten minutes.',{status:429});
    this.attempts.push(Date.now());
    const username=text(input.username,'username',{max:80,required:true}).toLowerCase(),password=text(input.password,'password',{max:500,required:true});
    const row=(await this.db.query('SELECT * FROM '+ns+'accounts WHERE username=$1',[username])).rows[0];
    const derived=await scrypt(password,row?.salt??'dummy-login-salt',64);
    if(!row||!row.active||!timingSafeEqual(derived,Buffer.from(row.password_hash,'hex')))throw new AppError('LOGIN_FAILED','Username or password was not accepted.',{status:401});
    const token=randomBytes(32).toString('hex');await this.db.query("INSERT INTO "+ns+"logins VALUES($1,$2,CURRENT_TIMESTAMP+INTERVAL '12 hours')",[hash(token),row.id]);
    this.attempts=[];return {cookie:this.cookie(token),user:{id:row.id,username:row.username,role:row.role}};
  }
  async logout(req){const token=req.headers.cookie?.match(/fiftytoc_login=([a-f0-9]{64})/)?.[1];if(token)await this.db.query('DELETE FROM '+ns+'logins WHERE token_hash=$1',[hash(token)]);return this.cookie('');}
  async users(){return (await this.db.query('SELECT id,username,role,active,body FROM '+ns+'accounts ORDER BY username')).rows.map(r=>({id:r.id,username:r.username,role:r.role,active:r.active,name:r.body.name}));}
  async add(input,actor){
    const username=text(input.username,'username',{max:80,required:true}).toLowerCase(),name=text(input.name??input.username,'display name',{max:100,required:true});
    if(!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(username))throw new AppError('USERNAME_INVALID','Use at least 3 letters, numbers, dots, underscores or hyphens for the username.');
    const password=text(input.password,'password',{max:500,required:true});if(password.length<12)throw new AppError('PASSWORD_SHORT','Use a password of at least 12 characters.');
    if(!['manager','worker'].includes(input.role))throw new AppError('ROLE_INVALID','Choose full access or worker access.');
    const salt=randomBytes(16).toString('hex'),passwordHash=(await scrypt(password,salt,64)).toString('hex');
    return this.db.transaction(async db=>{
      // Lock the settings row to serialize first-account creation and preserve at least one manager.
      await db.query("INSERT INTO "+ns+"settings VALUES('account_setup_lock','{}') ON CONFLICT DO NOTHING");await db.query("SELECT key FROM "+ns+"settings WHERE key='account_setup_lock' FOR UPDATE");
      const enabled=(await db.query('SELECT id FROM '+ns+'accounts LIMIT 1')).rows.length>0;
      if(enabled&&actor?.local)throw new AppError('AUTH_REQUIRED','Sign in as a full-access user.',{status:401});
      if(actor?.role!=='manager')throw new AppError('MANAGER_REQUIRED','Full access is required.',{status:403});
      if(!enabled&&input.role!=='manager')throw new AppError('MANAGER_REQUIRED','The first account must have full access.');
      if((await db.query('SELECT id FROM '+ns+'accounts WHERE username=$1',[username])).rows.length)throw new AppError('USERNAME_EXISTS','That username is already in use.',{status:409});
      const user={id:randomUUID(),username,role:input.role,name,createdAt:new Date().toISOString(),createdBy:actor.id};
      await db.query('INSERT INTO '+ns+'accounts(id,username,role,salt,password_hash,body) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[user.id,username,user.role,salt,passwordHash,JSON.stringify(user)]);
      return user;
    });
  }
  require(user,role='manager'){if(!user)throw new AppError('AUTH_REQUIRED','Sign in to continue.',{status:401});if(role==='manager'&&user.role!=='manager')throw new AppError('MANAGER_REQUIRED','This action requires full access.',{status:403});return user;}
}
