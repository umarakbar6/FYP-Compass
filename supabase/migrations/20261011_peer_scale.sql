begin;
-- Versioned health scale: 1=0%, 3=50%, 5=100%; grading is unchanged.
do $$declare definition text;begin
 select pg_get_functiondef('fyp_health_v2.rules(jsonb,jsonb,timestamptz)'::regprocedure) into definition;
 if position('av/5*100' in definition)>0 then
 definition:=replace(definition,'av/5*100','(av-1)/4*100');
 definition:=replace(definition,'''version'',''1''','''version'',''2''');
 execute definition;
 end if;
end $$;


commit;
